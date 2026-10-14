import * as z from 'zod';

/** Logical identifiers. Tools accept these, never file paths. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const EXAMPLE_ID_PATTERN = /^(ex|demo)-[a-z0-9][a-z0-9-]{2,79}$/;
/** SCHEMA.TABLE with ordinary (undelimited) Db2 identifiers; matched exactly. */
export const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_$#@]{0,127}\.[A-Za-z_][A-Za-z0-9_$#@]{0,127}$/;

export const INPUT_LIMITS = {
  query: 500,
  question: 2_000,
  sql: 20_000,
  listItems: 25,
  listItemChars: 300,
  notes: 4_000,
  reviewerName: 120,
  reason: 2_000,
} as const;

const logicalId = z.string().regex(ID_PATTERN, 'must be a lowercase logical ID (a-z, 0-9, "_" or "-")');
const relPath = z.string().min(1).max(400);

export const Db2PlatformSchema = z.enum(['unspecified', 'luw', 'zos', 'ibmi']);
export type Db2Platform = z.infer<typeof Db2PlatformSchema>;

export const ManifestSchema = z.object({
  contextVersion: z.string().min(1).max(64),
  description: z.string().max(2_000).optional(),
  fictional: z.boolean().default(false),
  db2: z.object({
    platform: Db2PlatformSchema,
    version: z.string().max(64).nullable().default(null),
    notes: z.string().max(2_000).optional(),
  }),
  domains: z
    .array(
      z.object({
        id: logicalId,
        name: z.string().min(1).max(200),
        description: z.string().max(2_000),
        fictional: z.boolean().default(false),
      }),
    )
    .min(1),
  tables: z.array(
    z.object({
      name: z.string().regex(TABLE_NAME_PATTERN, 'must be a schema-qualified table name such as APP.CUSTOMER_MASTER'),
      domain: logicalId,
      schemaPath: relPath,
      description: z.string().max(2_000),
      grain: z.string().max(500).optional(),
      primaryKey: z.array(z.string().max(128)).default([]),
      tags: z.array(z.string().max(64)).default([]),
    }),
  ),
  documents: z.array(
    z.object({
      id: logicalId,
      domain: logicalId,
      title: z.string().min(1).max(300),
      path: relPath,
      tags: z.array(z.string().max(64)).default([]),
    }),
  ),
});
export type Manifest = z.infer<typeof ManifestSchema>;
export type TableEntry = Manifest['tables'][number];
export type DocumentEntry = Manifest['documents'][number];
export type DomainEntry = Manifest['domains'][number];

// ---------------------------------------------------------------------------
// Example records
// ---------------------------------------------------------------------------

const listOf = (max = INPUT_LIMITS.listItems) =>
  z.array(z.string().trim().min(1).max(INPUT_LIMITS.listItemChars)).max(max);

/** Fields supplied by whoever submits an example (MCP tool input). */
export const ExampleSubmissionSchema = z.object({
  question: z.string().trim().min(5).max(INPUT_LIMITS.question),
  sql: z.string().min(5).max(INPUT_LIMITS.sql),
  domain: logicalId,
  tables: z.array(z.string().regex(TABLE_NAME_PATTERN)).min(1).max(INPUT_LIMITS.listItems),
  businessRuleIds: z.array(logicalId).max(INPUT_LIMITS.listItems),
  assumptions: listOf(),
  tags: z.array(z.string().trim().min(1).max(64)).max(INPUT_LIMITS.listItems),
  notes: z.string().max(INPUT_LIMITS.notes).optional(),
});
export type ExampleSubmission = z.infer<typeof ExampleSubmissionSchema>;

const AdvisoryLintSchema = z.object({
  label: z.literal('advisory-only regex checks; not a Db2 parser and not proof of validity or safety'),
  warnings: z.array(z.string()),
});

const ReviewSchema = z.object({
  reviewedAt: z.iso.datetime(),
  reviewerName: z.string().min(1).max(INPUT_LIMITS.reviewerName),
  reviewerIdentityVerified: z.literal(false),
  notes: z.string().max(INPUT_LIMITS.notes),
  contextVersionAtReview: z.string(),
});

const BaseExampleSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(EXAMPLE_ID_PATTERN),
  question: z.string().min(1).max(INPUT_LIMITS.question),
  sql: z.string().min(1).max(INPUT_LIMITS.sql),
  domain: logicalId,
  tables: z.array(z.string().regex(TABLE_NAME_PATTERN)).min(1),
  businessRuleIds: z.array(logicalId),
  assumptions: z.array(z.string()),
  tags: z.array(z.string()),
  notes: z.string().nullable(),
  contextVersion: z.string().min(1),
  createdAt: z.iso.datetime(),
  submittedVia: z.enum(['mcp', 'demo-seed', 'test-fixture']),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  fictional: z.boolean().default(false),
  advisoryLint: AdvisoryLintSchema,
});

export const PendingExampleSchema = BaseExampleSchema.extend({
  status: z.literal('pending'),
  validationStatus: z.literal('pending_human_review'),
  review: z.null(),
});

export const ApprovedExampleSchema = BaseExampleSchema.extend({
  status: z.literal('approved'),
  /** Approval never means the SQL was run. No other value is accepted. */
  validationStatus: z.literal('human_reviewed_not_executed'),
  review: ReviewSchema,
});

export const RejectedExampleSchema = BaseExampleSchema.extend({
  status: z.literal('rejected'),
  validationStatus: z.literal('rejected'),
  review: ReviewSchema.extend({ reason: z.string().min(1).max(INPUT_LIMITS.reason) }),
});

/** The demo seed is a pending-shaped record kept outside the review queue. */
export const DemoExampleSchema = PendingExampleSchema.extend({ fictional: z.literal(true) });

export const ExampleRecordSchema = z.discriminatedUnion('status', [
  PendingExampleSchema,
  ApprovedExampleSchema,
  RejectedExampleSchema,
]);

export type PendingExample = z.infer<typeof PendingExampleSchema>;
export type ApprovedExample = z.infer<typeof ApprovedExampleSchema>;
export type RejectedExample = z.infer<typeof RejectedExampleSchema>;
export type ExampleRecord = z.infer<typeof ExampleRecordSchema>;
export type ExampleStatus = ExampleRecord['status'];
