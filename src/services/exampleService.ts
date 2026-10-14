import type { AppConfig } from '../config.js';
import { NotFoundError, UserFacingError } from '../errors.js';
import type { ContextRepository } from '../repositories/contextRepository.js';
import type { ExampleRepository } from '../repositories/exampleRepository.js';
import type { ApprovedExample, ExampleSubmission, Manifest } from '../schemas.js';
import { queryTerms, rank, scoreFields } from './keywordSearch.js';

export const EXAMPLE_NOTICE =
  'Approved examples are human-reviewed PATTERNS, not answers to copy. None has been executed against Db2 ' +
  '(validationStatus "human_reviewed_not_executed"). Current business rules and schema take precedence over any example.';

export interface ContextCheck {
  reviewedAgainstContextVersion: string;
  currentContextVersion: string;
  stale: boolean;
  warnings: string[];
}

/** Flags examples reviewed against an older context, or that reference items no longer documented. */
export function checkAgainstContext(ex: ApprovedExample, m: Manifest): ContextCheck {
  const warnings: string[] = [];
  const reviewedAgainst = ex.review.contextVersionAtReview;
  const stale = reviewedAgainst !== m.contextVersion;
  if (stale) {
    warnings.push(
      `Reviewed against context version "${reviewedAgainst}" but current is "${m.contextVersion}". ` +
        'The example may be stale; re-check it against current business rules and schema, which take precedence.',
    );
  }
  const tableNames = new Set(m.tables.map((t) => t.name));
  const missingTables = ex.tables.filter((t) => !tableNames.has(t));
  if (missingTables.length) warnings.push(`References tables no longer documented: ${missingTables.join(', ')}`);
  const docIds = new Set(m.documents.map((d) => d.id));
  const missingRules = ex.businessRuleIds.filter((id) => !docIds.has(id));
  if (missingRules.length) warnings.push(`References business rules no longer documented: ${missingRules.join(', ')}`);
  return { reviewedAgainstContextVersion: reviewedAgainst, currentContextVersion: m.contextVersion, stale, warnings };
}

function present(ex: ApprovedExample, m: Manifest) {
  return {
    id: ex.id,
    source: `examples/approved/${ex.id}.json`,
    question: ex.question,
    sql: ex.sql,
    domain: ex.domain,
    tables: ex.tables,
    businessRuleIds: ex.businessRuleIds,
    assumptions: ex.assumptions,
    tags: ex.tags,
    notes: ex.notes,
    status: ex.status,
    validationStatus: ex.validationStatus,
    fictional: ex.fictional,
    createdAt: ex.createdAt,
    review: {
      reviewedAt: ex.review.reviewedAt,
      reviewerName: ex.review.reviewerName,
      reviewerIdentityVerified: false as const,
      reviewerNameNote: 'Self-reported in the local review CLI; not authenticated.',
      notes: ex.review.notes,
    },
    contextCheck: checkAgainstContext(ex, m),
  };
}

export class ExampleService {
  constructor(
    private readonly contextRepo: ContextRepository,
    private readonly examples: ExampleRepository,
    private readonly config: AppConfig,
  ) {}

  /** Searches APPROVED examples only. Reads the store on every call, so new approvals appear without restart. */
  async searchReviewed(input: { query: string; domain?: string | undefined; limit?: number | undefined }) {
    const m = await this.contextRepo.getManifest();
    if (input.domain) await this.contextRepo.requireDomain(input.domain, m);
    const terms = queryTerms(input.query);
    if (terms.length === 0) throw new UserFacingError('Query has no searchable keywords.');
    const { defaultResults, maxResults } = this.config.limits;
    const limit = Math.max(1, Math.min(input.limit ?? defaultResults, maxResults));

    const { records, problems } = await this.examples.list('approved');
    const scored = records
      .filter((r) => !input.domain || r.domain === input.domain)
      .map((r) => ({
        r,
        ...scoreFields(terms, [
          { text: r.question, weight: 3 },
          { text: r.tags.join(' '), weight: 3 },
          { text: r.tables.join(' '), weight: 2 },
          { text: r.domain, weight: 1 },
          { text: r.assumptions.join(' '), weight: 1 },
          { text: r.sql, weight: 1 },
        ]),
      }))
      .filter((x) => x.score > 0);
    const ranked = rank(scored, (x) => x.score, (x) => x.r.id);

    return {
      contextVersion: m.contextVersion,
      query: input.query,
      totalMatches: ranked.length,
      results: ranked.slice(0, limit).map((x) => ({ score: x.score, matchedTerms: x.matched, ...present(x.r, m) })),
      ...(problems.length ? { warnings: [`${problems.length} approved example file(s) were invalid and skipped.`] } : {}),
      notice: EXAMPLE_NOTICE,
    };
  }

  async getReviewed(id: string) {
    const m = await this.contextRepo.getManifest();
    let ex: ApprovedExample;
    try {
      ex = await this.examples.get('approved', id);
    } catch (err) {
      if (err instanceof NotFoundError) {
        const where = await this.examples.locate(id);
        if (where && where !== 'approved') {
          throw new NotFoundError(`Example "${id}" is ${where}, not approved; only approved examples can be retrieved.`);
        }
      }
      throw err;
    }
    return { contextVersion: m.contextVersion, example: present(ex, m), notice: EXAMPLE_NOTICE };
  }

  /** Creates a PENDING example. Never approves and never marks anything as executed or tested. */
  async submit(submission: ExampleSubmission) {
    const m = await this.contextRepo.getManifest();
    await this.contextRepo.requireDomain(submission.domain, m);
    for (const t of submission.tables) this.contextRepo.findTable(m, t);
    const docIds = new Set(m.documents.map((d) => d.id));
    const unknownRules = submission.businessRuleIds.filter((id) => !docIds.has(id));
    if (unknownRules.length) {
      throw new NotFoundError(
        `Unknown business rule IDs: ${unknownRules.join(', ')}. Known IDs: ${[...docIds].join(', ')}`,
      );
    }

    const { record, previouslyRejected } = await this.examples.createPending(submission, {
      contextVersion: m.contextVersion,
      submittedVia: 'mcp',
    });

    return {
      pendingId: record.id,
      status: record.status,
      validationStatus: record.validationStatus,
      contextVersion: record.contextVersion,
      advisoryLint: record.advisoryLint,
      ...(previouslyRejected.length
        ? { previouslyRejected, previouslyRejectedNote: 'Identical question/SQL was rejected before; the reviewer will see this.' }
        : {}),
      message:
        'Submitted as PENDING. It is NOT approved, has NOT been executed, and will NOT be returned by ' +
        'search_reviewed_examples until a human approves it with the local review CLI.',
      humanReviewSteps: [
        'npm run review -- list',
        `npm run review -- show ${record.id}`,
        `npm run review -- approve ${record.id}    (interactive confirmation required)`,
        `npm run review -- reject ${record.id}     (records a reason for audit)`,
      ],
    };
  }
}
