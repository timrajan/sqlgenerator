import { UserFacingError } from '../errors.js';
import type { ContextRepository } from '../repositories/contextRepository.js';
import type { ExampleRepository } from '../repositories/exampleRepository.js';
import { INPUT_LIMITS, type ApprovedExample, type PendingExample, type RejectedExample } from '../schemas.js';

/**
 * Interactive I/O used by the review flow. The CLI wires this to a TTY;
 * tests inject scripted answers. There is intentionally no non-interactive
 * "yes" path: every decision goes through `ask`.
 */
export interface ReviewIO {
  print(text: string): void;
  ask(question: string): Promise<string>;
}

export function approvalPhrase(id: string): string {
  return `APPROVE ${id}`;
}

export function rejectionPhrase(id: string): string {
  return `REJECT ${id}`;
}

/** Full, human-readable rendering shown before any decision. */
export function renderExample(ex: PendingExample, currentContextVersion: string): string {
  const lines = [
    `ID:                 ${ex.id}${ex.fictional ? '   [FICTIONAL DEMO]' : ''}`,
    `Status:             ${ex.status} (${ex.validationStatus})`,
    `Domain:             ${ex.domain}`,
    `Created:            ${ex.createdAt} via ${ex.submittedVia}`,
    `Context version:    ${ex.contextVersion} (current: ${currentContextVersion})`,
    '',
    'Question:',
    `  ${ex.question}`,
    '',
    'SQL (exact text that would be approved):',
    '-----8<-----',
    ex.sql,
    '-----8<-----',
    '',
    `Tables:             ${ex.tables.join(', ')}`,
    `Business rule IDs:  ${ex.businessRuleIds.join(', ') || '(none)'}`,
    'Assumptions:',
    ...(ex.assumptions.length ? ex.assumptions.map((a) => `  - ${a}`) : ['  (none)']),
    `Tags:               ${ex.tags.join(', ') || '(none)'}`,
    `Submitter notes:    ${ex.notes ?? '(none)'}`,
    '',
    `Advisory lint (${ex.advisoryLint.label}):`,
    ...(ex.advisoryLint.warnings.length ? ex.advisoryLint.warnings.map((w) => `  ! ${w}`) : ['  (no warnings)']),
  ];
  if (ex.contextVersion !== currentContextVersion) {
    lines.push('', `WARNING: submitted against context "${ex.contextVersion}", current is "${currentContextVersion}".`);
  }
  return lines.join('\n');
}

async function askNonEmpty(io: ReviewIO, prompt: string, max: number, provided?: string): Promise<string> {
  const value = (provided ?? (await io.ask(prompt))).trim();
  if (!value) throw new UserFacingError(`${prompt.replace(/[:\s]+$/, '')} is required.`);
  if (value.length > max) throw new UserFacingError(`Value is longer than ${max} characters.`);
  return value;
}

export class ReviewService {
  constructor(private readonly contextRepo: ContextRepository, private readonly examples: ExampleRepository) {}

  listPending() {
    return this.examples.list('pending');
  }

  listRejected() {
    return this.examples.list('rejected');
  }

  async show(id: string): Promise<string> {
    const [ex, m] = await Promise.all([this.examples.get('pending', id), this.contextRepo.getManifest()]);
    return renderExample(ex, m.contextVersion);
  }

  /**
   * Displays the full example, then requires the reviewer to type the exact
   * phrase "APPROVE <id>". Anything else cancels without changing storage.
   */
  async approve(
    id: string,
    io: ReviewIO,
    opts: { reviewerName?: string | undefined; notes?: string | undefined } = {},
  ): Promise<ApprovedExample | null> {
    const [ex, m] = await Promise.all([this.examples.get('pending', id), this.contextRepo.getManifest()]);
    io.print(renderExample(ex, m.contextVersion));
    io.print(
      '\nApproval records that a human reviewed this SQL. It does NOT mean the SQL was executed or tested ' +
        '(validationStatus will be "human_reviewed_not_executed"). Reviewer names are self-reported, not authenticated.\n',
    );
    const reviewerName = await askNonEmpty(io, 'Reviewer name: ', INPUT_LIMITS.reviewerName, opts.reviewerName);
    const notes = (opts.notes ?? (await io.ask('Review notes (optional): '))).trim().slice(0, INPUT_LIMITS.notes);
    const phrase = approvalPhrase(id);
    const answer = (await io.ask(`Type "${phrase}" to approve, anything else to cancel: `)).trim();
    if (answer !== phrase) {
      io.print('Cancelled. Nothing was changed.');
      return null;
    }
    const approved = await this.examples.approve(id, {
      reviewerName,
      notes,
      contextVersionAtReview: m.contextVersion,
    });
    io.print(`Approved ${id}. It is now returned by search_reviewed_examples (no server restart needed).`);
    return approved;
  }

  async reject(
    id: string,
    io: ReviewIO,
    opts: { reviewerName?: string | undefined; reason?: string | undefined } = {},
  ): Promise<RejectedExample | null> {
    const [ex, m] = await Promise.all([this.examples.get('pending', id), this.contextRepo.getManifest()]);
    io.print(renderExample(ex, m.contextVersion));
    const reviewerName = await askNonEmpty(io, 'Reviewer name: ', INPUT_LIMITS.reviewerName, opts.reviewerName);
    const reason = await askNonEmpty(io, 'Rejection reason: ', INPUT_LIMITS.reason, opts.reason);
    const phrase = rejectionPhrase(id);
    const answer = (await io.ask(`Type "${phrase}" to reject, anything else to cancel: `)).trim();
    if (answer !== phrase) {
      io.print('Cancelled. Nothing was changed.');
      return null;
    }
    const rejected = await this.examples.reject(id, {
      reviewerName,
      notes: '',
      reason,
      contextVersionAtReview: m.contextVersion,
    });
    io.print(`Rejected ${id}. The record is kept in examples/rejected/ for audit and is never served.`);
    return rejected;
  }

  /** Copies the fictional demo seed(s) into the pending queue so a human can practise the review flow. */
  async seedDemo(): Promise<string[]> {
    const m = await this.contextRepo.getManifest();
    const { records, problems } = await this.examples.listDemo();
    if (problems.length) throw new UserFacingError(`Invalid demo file(s): ${problems.map((p) => p.file).join(', ')}`);
    const created: string[] = [];
    for (const demo of records) {
      const { record } = await this.examples.createPending(
        {
          question: demo.question,
          sql: demo.sql,
          domain: demo.domain,
          tables: demo.tables,
          businessRuleIds: demo.businessRuleIds,
          assumptions: demo.assumptions,
          tags: demo.tags,
          notes: demo.notes ?? undefined,
        },
        { contextVersion: m.contextVersion, submittedVia: 'demo-seed', fictional: true },
      );
      created.push(record.id);
    }
    return created;
  }
}
