import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, PROJECT_ROOT, type AppConfig } from '../../src/config.js';
import { fingerprint } from '../../src/repositories/exampleRepository.js';
import { ApprovedExampleSchema, type ApprovedExample } from '../../src/schemas.js';
import { createServices, type Services } from '../../src/services/container.js';
import type { ReviewIO } from '../../src/services/reviewService.js';
import { advisoryLint } from '../../src/services/sqlAdvisory.js';

export interface TempContext {
  root: string;
  contextDir: string;
  examplesDir: string;
  config: AppConfig;
  services: Services;
  cleanup(): Promise<void>;
}

/**
 * Copies the repository's demo context (manifest, schema, rules, demo seed)
 * into a fresh temp directory. Real example storage is never touched.
 */
export async function makeTempContext(): Promise<TempContext> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlgen-test-'));
  const contextDir = path.join(root, 'context');
  const src = path.join(PROJECT_ROOT, 'context');
  await fs.cp(src, contextDir, {
    recursive: true,
    filter: (p) => {
      const rel = path.relative(src, p).split(path.sep);
      return !(rel[0] === 'examples' && ['approved', 'pending', 'rejected', '.lock'].includes(rel[1] ?? ''));
    },
  });
  const examplesDir = path.join(contextDir, 'examples');
  for (const d of ['approved', 'pending', 'rejected']) await fs.mkdir(path.join(examplesDir, d), { recursive: true });
  const config = loadConfig({ projectRoot: root, contextDir, examplesDir });
  return {
    root,
    contextDir,
    examplesDir,
    config,
    services: createServices(config),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

export async function readManifest(ctx: TempContext): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(ctx.contextDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
}

export async function writeManifest(ctx: TempContext, manifest: unknown): Promise<void> {
  await fs.writeFile(path.join(ctx.contextDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

/** Writes an approved TEST FIXTURE directly into temp storage (test-only; never in real storage). */
export async function writeApprovedFixture(
  ctx: TempContext,
  overrides: Partial<ApprovedExample> & { id: string },
): Promise<ApprovedExample> {
  const question = overrides.question ?? 'Fixture question about customer ages';
  const sql = overrides.sql ?? 'SELECT CUSTOMER_ID FROM APP.CUSTOMER_MASTER WHERE AGE > 40';
  const record = ApprovedExampleSchema.parse({
    schemaVersion: 1,
    status: 'approved',
    validationStatus: 'human_reviewed_not_executed',
    question,
    sql,
    domain: 'customer',
    tables: ['APP.CUSTOMER_MASTER'],
    businessRuleIds: ['customer-search-rules'],
    assumptions: [],
    tags: ['fixture'],
    notes: null,
    contextVersion: 'demo-2026-10-13.1',
    createdAt: '2026-10-01T00:00:00.000Z',
    submittedVia: 'test-fixture',
    fingerprint: fingerprint(question, sql),
    fictional: true,
    advisoryLint: advisoryLint(sql),
    review: {
      reviewedAt: '2026-10-02T00:00:00.000Z',
      reviewerName: 'Test Fixture (not a real reviewer)',
      reviewerIdentityVerified: false,
      notes: '',
      contextVersionAtReview: 'demo-2026-10-13.1',
    },
    ...overrides,
  });
  await fs.writeFile(path.join(ctx.examplesDir, 'approved', `${record.id}.json`), JSON.stringify(record, null, 2));
  return record;
}

/** Review I/O driven by a fixed list of answers; records everything printed. */
export function scriptedIO(answers: string[]): ReviewIO & { printed: string[]; asked: string[] } {
  const queue = [...answers];
  const printed: string[] = [];
  const asked: string[] = [];
  return {
    printed,
    asked,
    print: (t) => void printed.push(t),
    ask: async (q) => {
      asked.push(q);
      const a = queue.shift();
      if (a === undefined) throw new Error(`Unexpected prompt: ${q}`);
      return a;
    },
  };
}

export const SAMPLE_SUBMISSION = {
  question: 'How many customers live in postcode 0800?',
  sql: "SELECT COUNT(*) AS CUSTOMER_COUNT\nFROM APP.CUSTOMER_MASTER\nWHERE RESIDENTIAL_POSTCODE = '0800'",
  domain: 'customer',
  tables: ['APP.CUSTOMER_MASTER'],
  businessRuleIds: ['customer-search-rules'],
  assumptions: ['Postcode compared as string to keep the leading zero.'],
  tags: ['postcode', 'count'],
};
