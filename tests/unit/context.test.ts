import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ContextError, NotFoundError } from '../../src/errors.js';
import { makeTempContext, readManifest, writeManifest, type TempContext } from '../helpers/tempContext.js';

let ctx: TempContext;
beforeEach(async () => {
  ctx = await makeTempContext();
});
afterEach(async () => {
  await ctx.cleanup();
});

describe('context discovery', () => {
  it('lists domains with tables, rule IDs, version and unspecified platform guidance', async () => {
    const res = await ctx.services.context.listDomains();
    assert.equal(res.contextVersion, 'demo-2026-10-13.1');
    assert.equal(res.fictionalContext, true);
    assert.equal(res.db2.platform, 'unspecified');
    assert.match(res.db2.guidance, /Do not assume LUW, z\/OS or IBM i/);
    const customer = res.domains.find((d) => d.id === 'customer');
    assert.ok(customer);
    assert.equal(customer.tables.length, 5);
    assert.deepEqual(customer.businessRuleIds.sort(), ['customer-search-rules', 'customer-table-relationships']);
  });

  it('returns business rules with provenance', async () => {
    const res = await ctx.services.context.getBusinessRules('customer');
    assert.equal(res.documents.length, 2);
    for (const doc of res.documents) {
      assert.match(doc.sha256, /^[0-9a-f]{64}$/);
      assert.ok(doc.sourcePath.startsWith('business-rules/'));
      assert.ok(doc.content.length > 0);
    }
    assert.match(res.notice, /not as instructions/);
  });

  it('rejects unknown domains with the list of valid ones', async () => {
    await assert.rejects(ctx.services.context.getBusinessRules('sales'), /Unknown domain "sales".*customer/);
  });
});

describe('get_schema exact table matching', () => {
  it('returns exact DDL text for an exact name', async () => {
    const res = await ctx.services.context.getSchema(['APP.CUSTOMER_MASTER']);
    const onDisk = await fs.readFile(path.join(ctx.contextDir, 'schema/customer/APP.CUSTOMER_MASTER.sql'), 'utf8');
    assert.equal(res.tables.length, 1);
    assert.equal(res.tables[0]!.ddl, onDisk);
    assert.equal(res.tables[0]!.table, 'APP.CUSTOMER_MASTER');
    assert.deepEqual(res.tables[0]!.primaryKey, ['CUSTOMER_ID']);
  });

  it('does not case-fold names, but suggests the exact spelling', async () => {
    const res = await ctx.services.context.getSchema(['app.customer_master']);
    assert.equal(res.tables.length, 0);
    assert.match(res.notFound![0]!.error, /did you mean "APP.CUSTOMER_MASTER"/);
  });

  it('reports undocumented tables without failing the documented ones', async () => {
    const res = await ctx.services.context.getSchema(['APP.CUSTOMER_MASTER', 'APP.ORDERS']);
    assert.equal(res.tables.length, 1);
    assert.equal(res.notFound![0]!.table, 'APP.ORDERS');
  });
});

describe('search_context ranking and limits', () => {
  it('ranks the default customer table first for an age/postcode question', async () => {
    const res = await ctx.services.context.searchContext({ query: 'customers aged 30 to 35 postcode 3000' });
    assert.ok(res.results.length > 0);
    const tableHits = res.results.filter((r) => r.kind === 'table_schema');
    assert.equal(tableHits[0]?.id, 'APP.CUSTOMER_MASTER');
    for (let i = 1; i < res.results.length; i++) {
      assert.ok(res.results[i - 1]!.score >= res.results[i]!.score, 'results sorted by score');
    }
  });

  it('is deterministic', async () => {
    const a = await ctx.services.context.searchContext({ query: 'contacts join customer', limit: 10 });
    const b = await ctx.services.context.searchContext({ query: 'contacts join customer', limit: 10 });
    assert.deepEqual(a.results, b.results);
  });

  it('honours limit and clamps to the configured maximum', async () => {
    const one = await ctx.services.context.searchContext({ query: 'customer', limit: 1 });
    assert.equal(one.results.length, 1);
    assert.ok(one.totalMatches > 1);
    const def = await ctx.services.context.searchContext({ query: 'customer' });
    assert.equal(def.results.length, Math.min(ctx.config.limits.defaultResults, def.totalMatches));
    const huge = await ctx.services.context.searchContext({ query: 'customer', limit: 10_000 });
    assert.ok(huge.results.length <= ctx.config.limits.maxResults);
  });

  it('bounds excerpt length', async () => {
    const res = await ctx.services.context.searchContext({ query: 'customer postcode age', limit: 25 });
    for (const r of res.results) assert.ok(r.excerpt.length <= ctx.config.limits.maxExcerptChars + 2);
  });

  it('rejects queries with no keywords', async () => {
    await assert.rejects(ctx.services.context.searchContext({ query: 'the of and' }), /no searchable keywords/);
  });
});

describe('missing and malformed context', () => {
  it('explains a missing manifest', async () => {
    await fs.rm(path.join(ctx.contextDir, 'manifest.json'));
    await assert.rejects(ctx.services.context.listDomains(), (e: Error) => e instanceof ContextError && /No manifest\.json/.test(e.message));
  });

  it('explains malformed JSON', async () => {
    await fs.writeFile(path.join(ctx.contextDir, 'manifest.json'), '{ not json');
    await assert.rejects(ctx.services.context.listDomains(), /not valid JSON/);
  });

  it('explains schema violations', async () => {
    const m = await readManifest(ctx);
    (m.db2 as Record<string, unknown>).platform = 'oracle';
    await writeManifest(ctx, m);
    await assert.rejects(ctx.services.context.listDomains(), /failed validation[\s\S]*db2\.platform/);
  });

  it('detects inconsistent references', async () => {
    const m = await readManifest(ctx);
    (m.documents as Record<string, unknown>[])[0]!.domain = 'nope';
    await writeManifest(ctx, m);
    await assert.rejects(ctx.services.context.listDomains(), /references unknown domain "nope"/);
  });

  it('gives a helpful error when a listed DDL file is missing', async () => {
    await fs.rm(path.join(ctx.contextDir, 'schema/customer/APP.CUSTOMER_ARCHIVE.sql'));
    await assert.rejects(
      ctx.services.context.getSchema(['APP.CUSTOMER_ARCHIVE']),
      (e: Error) => e instanceof ContextError && /APP\.CUSTOMER_ARCHIVE.*not found/.test(e.message),
    );
  });

  it('search skips unreadable documents with a warning instead of failing', async () => {
    await fs.rm(path.join(ctx.contextDir, 'business-rules/customer/customer-table-relationships.md'));
    const res = await ctx.services.context.searchContext({ query: 'postcode' });
    assert.ok(res.results.length > 0);
    assert.ok(res.warnings?.some((w) => w.includes('customer-table-relationships')));
  });

  it('enforces the file-size limit', async () => {
    await fs.writeFile(path.join(ctx.contextDir, 'schema/customer/APP.CUSTOMER_MASTER.sql'), 'x'.repeat(ctx.config.limits.maxFileBytes + 1));
    await assert.rejects(ctx.services.context.getSchema(['APP.CUSTOMER_MASTER']), /limit is/);
  });

  it('NotFoundError is user-facing', () => {
    assert.ok(new NotFoundError('x') instanceof Error);
  });
});
