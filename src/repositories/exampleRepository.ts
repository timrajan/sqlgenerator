import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DuplicateExampleError, NotFoundError, UserFacingError } from '../errors.js';
import { logger } from '../logger.js';
import {
  ApprovedExampleSchema,
  DemoExampleSchema,
  EXAMPLE_ID_PATTERN,
  ExampleRecordSchema,
  PendingExampleSchema,
  RejectedExampleSchema,
  type ApprovedExample,
  type ExampleRecord,
  type ExampleStatus,
  type ExampleSubmission,
  type PendingExample,
  type RejectedExample,
} from '../schemas.js';
import { advisoryLint } from '../services/sqlAdvisory.js';
import { withDirLock } from './fileLock.js';
import { ensureDirWithinRoot, readFileWithinRoot } from './safePath.js';

const STATUS_DIRS: Record<ExampleStatus, string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};

type RecordFor<S extends ExampleStatus> = S extends 'pending'
  ? PendingExample
  : S extends 'approved'
    ? ApprovedExample
    : RejectedExample;

export interface ListResult<T> {
  records: T[];
  /** Files that could not be read or failed validation; never returned as examples. */
  problems: { file: string; error: string }[];
}

export interface ReviewInput {
  reviewerName: string;
  notes: string;
  contextVersionAtReview: string;
}

/**
 * Normalisation for exact-duplicate detection: question whitespace/case,
 * SQL line endings, trailing whitespace and a trailing semicolon are ignored.
 * Everything else (including whitespace inside SQL lines) counts.
 */
export function fingerprint(question: string, sql: string): string {
  const q = question.trim().replace(/\s+/g, ' ').toLowerCase();
  const s = sql
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim()
    .replace(/;\s*$/, '')
    .trimEnd();
  return createHash('sha256').update(`${q}\u0000${s}`, 'utf8').digest('hex');
}

export function newExampleId(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `ex-${day}-${randomBytes(6).toString('hex')}`;
}

function assertExampleId(id: string): void {
  if (!EXAMPLE_ID_PATTERN.test(id)) {
    throw new UserFacingError(`Invalid example ID "${id}". IDs look like ex-20260101-0123456789ab.`);
  }
}

/**
 * File-backed example store:
 *   <examplesDir>/pending/<id>.json   awaiting human review (never served as reusable)
 *   <examplesDir>/approved/<id>.json  human-approved; the only records search returns
 *   <examplesDir>/rejected/<id>.json  audit history of rejections
 *   <examplesDir>/demo/*.json         fictional seed records, outside the review queue
 *
 * Mutations run under a directory lock and write via temp file + rename, so
 * readers never see partial files and nothing is silently overwritten.
 */
export class ExampleRepository {
  constructor(private readonly examplesDir: string, private readonly maxFileBytes: number) {}

  private async dir(status: ExampleStatus | 'demo'): Promise<string> {
    await fs.mkdir(this.examplesDir, { recursive: true });
    const sub = status === 'demo' ? 'demo' : STATUS_DIRS[status];
    return ensureDirWithinRoot(this.examplesDir, path.join(this.examplesDir, sub));
  }

  async list<S extends ExampleStatus>(status: S): Promise<ListResult<RecordFor<S>>> {
    const dir = await this.dir(status);
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort();
    const records: RecordFor<S>[] = [];
    const problems: ListResult<RecordFor<S>>['problems'] = [];
    for (const name of names) {
      const rel = `${STATUS_DIRS[status]}/${name}`;
      try {
        const rec = await this.readRecord(rel);
        if (rec.status !== status) throw new Error(`status "${rec.status}" does not match folder "${status}"`);
        if (`${rec.id}.json` !== name) throw new Error(`file name does not match id "${rec.id}"`);
        records.push(rec as RecordFor<S>);
      } catch (err) {
        problems.push({ file: rel, error: (err as Error).message });
        logger.warn(`Skipping invalid example file ${rel}:`, err);
      }
    }
    return { records, problems };
  }

  async get<S extends ExampleStatus>(status: S, id: string): Promise<RecordFor<S>> {
    assertExampleId(id);
    const rel = `${STATUS_DIRS[status]}/${id}.json`;
    await this.dir(status);
    let rec: ExampleRecord;
    try {
      rec = await this.readRecord(rel);
    } catch (err) {
      if (err instanceof NotFoundError) throw new NotFoundError(`No ${status} example with ID "${id}"`);
      throw err;
    }
    if (rec.status !== status || rec.id !== id) {
      throw new UserFacingError(`Example file ${rel} is inconsistent (id/status mismatch)`);
    }
    return rec as RecordFor<S>;
  }

  /** Returns the status folder an ID currently lives in, if any. */
  async locate(id: string): Promise<ExampleStatus | null> {
    assertExampleId(id);
    for (const status of ['approved', 'pending', 'rejected'] as const) {
      try {
        await fs.access(path.join(await this.dir(status), `${id}.json`));
        return status;
      } catch {
        /* not here */
      }
    }
    return null;
  }

  async listDemo(): Promise<ListResult<PendingExample>> {
    const dir = await this.dir('demo');
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort();
    const records: PendingExample[] = [];
    const problems: { file: string; error: string }[] = [];
    for (const name of names) {
      try {
        const raw = await readFileWithinRoot(this.examplesDir, `demo/${name}`, this.maxFileBytes);
        records.push(DemoExampleSchema.parse(JSON.parse(raw)));
      } catch (err) {
        problems.push({ file: `demo/${name}`, error: (err as Error).message });
      }
    }
    return { records, problems };
  }

  /** Creates a PENDING record. There is deliberately no way to create an approved one here. */
  async createPending(
    submission: ExampleSubmission,
    opts: { contextVersion: string; submittedVia: 'mcp' | 'demo-seed'; fictional?: boolean; now?: Date },
  ): Promise<{ record: PendingExample; previouslyRejected: string[] }> {
    const now = opts.now ?? new Date();
    const fp = fingerprint(submission.question, submission.sql);

    return withDirLock(this.examplesDir, async () => {
      const [pending, approved, rejected] = await Promise.all([
        this.list('pending'),
        this.list('approved'),
        this.list('rejected'),
      ]);
      const dupApproved = approved.records.find((r) => r.fingerprint === fp);
      if (dupApproved) {
        throw new DuplicateExampleError(
          `An identical question and SQL is already approved as "${dupApproved.id}". Use get_reviewed_example instead of resubmitting.`,
        );
      }
      const dupPending = pending.records.find((r) => r.fingerprint === fp);
      if (dupPending) {
        throw new DuplicateExampleError(`An identical question and SQL is already pending review as "${dupPending.id}".`);
      }

      const record = PendingExampleSchema.parse({
        schemaVersion: 1,
        id: newExampleId(now),
        status: 'pending',
        validationStatus: 'pending_human_review',
        question: submission.question,
        sql: submission.sql,
        domain: submission.domain,
        tables: submission.tables,
        businessRuleIds: submission.businessRuleIds,
        assumptions: submission.assumptions,
        tags: submission.tags,
        notes: submission.notes ?? null,
        contextVersion: opts.contextVersion,
        createdAt: now.toISOString(),
        submittedVia: opts.submittedVia,
        fingerprint: fp,
        fictional: opts.fictional ?? false,
        advisoryLint: advisoryLint(submission.sql),
        review: null,
      } satisfies PendingExample);

      await this.writeNew('pending', record);
      return {
        record,
        previouslyRejected: rejected.records.filter((r) => r.fingerprint === fp).map((r) => r.id),
      };
    });
  }

  /** Moves a pending record to approved. Only the review service calls this, after interactive confirmation. */
  async approve(id: string, review: ReviewInput, now = new Date()): Promise<ApprovedExample> {
    assertExampleId(id);
    return withDirLock(this.examplesDir, async () => {
      const pending = await this.get('pending', id);
      const approved = await this.list('approved');
      const dup = approved.records.find((r) => r.fingerprint === pending.fingerprint || r.id === id);
      if (dup) {
        throw new DuplicateExampleError(`Example "${dup.id}" with identical question and SQL is already approved.`);
      }
      const record = ApprovedExampleSchema.parse({
        ...pending,
        status: 'approved',
        validationStatus: 'human_reviewed_not_executed',
        review: {
          reviewedAt: now.toISOString(),
          reviewerName: review.reviewerName,
          reviewerIdentityVerified: false,
          notes: review.notes,
          contextVersionAtReview: review.contextVersionAtReview,
        },
      } satisfies ApprovedExample);
      await this.writeNew('approved', record);
      await fs.rm(path.join(await this.dir('pending'), `${id}.json`));
      return record;
    });
  }

  async reject(id: string, review: ReviewInput & { reason: string }, now = new Date()): Promise<RejectedExample> {
    assertExampleId(id);
    return withDirLock(this.examplesDir, async () => {
      const pending = await this.get('pending', id);
      const record = RejectedExampleSchema.parse({
        ...pending,
        status: 'rejected',
        validationStatus: 'rejected',
        review: {
          reviewedAt: now.toISOString(),
          reviewerName: review.reviewerName,
          reviewerIdentityVerified: false,
          notes: review.notes,
          contextVersionAtReview: review.contextVersionAtReview,
          reason: review.reason,
        },
      } satisfies RejectedExample);
      await this.writeNew('rejected', record);
      await fs.rm(path.join(await this.dir('pending'), `${id}.json`));
      return record;
    });
  }

  private async readRecord(rel: string): Promise<ExampleRecord> {
    const raw = await readFileWithinRoot(this.examplesDir, rel, this.maxFileBytes);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new UserFacingError(`${rel} is not valid JSON: ${(err as Error).message}`);
    }
    const parsed = ExampleRecordSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.map(String).join('.')}: ${i.message}`)
        .join('; ');
      throw new UserFacingError(`${rel} failed validation: ${issues}`);
    }
    return parsed.data;
  }

  /** Atomic create: temp file in the same folder, fsync, then rename only if the target is absent. Caller holds the lock. */
  private async writeNew(status: ExampleStatus, record: ExampleRecord): Promise<void> {
    const dir = await this.dir(status);
    const target = path.join(dir, `${record.id}.json`);
    const tmp = path.join(dir, `.${record.id}.json.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
    const handle = await fs.open(tmp, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      try {
        await fs.access(target);
        throw new DuplicateExampleError(`Refusing to overwrite existing ${status} example "${record.id}"`);
      } catch (err) {
        if (err instanceof DuplicateExampleError) throw err;
      }
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
}
