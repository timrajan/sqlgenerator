import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { DuplicateExampleError } from '../../src/errors.js';
import { ExampleRepository } from '../../src/repositories/exampleRepository.js';
import { createServices } from '../../src/services/container.js';
import { approvalPhrase, rejectionPhrase } from '../../src/services/reviewService.js';
import {
  makeTempContext,
  readManifest,
  SAMPLE_SUBMISSION,
  scriptedIO,
  writeApprovedFixture,
  writeManifest,
  type TempContext,
} from '../helpers/tempContext.js';

let ctx: TempContext;
beforeEach(async () => {
  ctx = await makeTempContext();
});
afterEach(async () => {
  await ctx.cleanup();
});

const files = async (ctx: TempContext, status: string) =>
  (await fs.readdir(path.join(ctx.examplesDir, status))).filter((f) => f.endsWith('.json')).sort();

describe('pending submission', () => {
  it('creates a pending record only, with no approval or execution claim', async () => {
    const res = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    assert.match(res.pendingId, /^ex-\d{8}-[0-9a-f]{12}$/);
    assert.equal(res.status, 'pending');
    assert.equal(res.validationStatus, 'pending_human_review');
    assert.match(res.message, /NOT approved, has NOT been executed/);
    assert.ok(res.humanReviewSteps.some((s) => s.includes(`approve ${res.pendingId}`)));
    assert.deepEqual(await files(ctx, 'pending'), [`${res.pendingId}.json`]);
    assert.deepEqual(await files(ctx, 'approved'), []);
    const raw = JSON.parse(await fs.readFile(path.join(ctx.examplesDir, 'pending', `${res.pendingId}.json`), 'utf8'));
    assert.equal(raw.review, null);
    assert.equal(raw.contextVersion, 'demo-2026-10-13.1');
  });

  it('rejects undocumented tables, unknown rules and unknown domains', async () => {
    await assert.rejects(ctx.services.examples.submit({ ...SAMPLE_SUBMISSION, tables: ['APP.ORDERS'] }), /not documented/);
    await assert.rejects(ctx.services.examples.submit({ ...SAMPLE_SUBMISSION, tables: ['app.customer_master'] }), /did you mean/);
    await assert.rejects(ctx.services.examples.submit({ ...SAMPLE_SUBMISSION, businessRuleIds: ['made-up'] }), /Unknown business rule IDs: made-up/);
    await assert.rejects(ctx.services.examples.submit({ ...SAMPLE_SUBMISSION, domain: 'sales' }), /Unknown domain/);
    assert.deepEqual(await files(ctx, 'pending'), []);
  });

  it('records advisory lint warnings without blocking', async () => {
    const res = await ctx.services.examples.submit({ ...SAMPLE_SUBMISSION, sql: 'DELETE FROM APP.CUSTOMER_MASTER' });
    assert.match(res.advisoryLint.label, /advisory-only/);
    assert.ok(res.advisoryLint.warnings.length > 0);
  });
});

describe('approved-only retrieval', () => {
  it('never returns pending examples from search or get', async () => {
    const res = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    const search = await ctx.services.examples.searchReviewed({ query: 'customers postcode 0800' });
    assert.equal(search.results.length, 0);
    await assert.rejects(ctx.services.examples.getReviewed(res.pendingId), /is pending, not approved/);
  });

  it('does not serve the fictional demo seed as an approved example', async () => {
    const search = await ctx.services.examples.searchReviewed({ query: 'customers aged 30 to 35 postcode 3000' });
    assert.equal(search.results.length, 0);
  });

  it('returns approved fixtures with review metadata and a non-executed status', async () => {
    await writeApprovedFixture(ctx, { id: 'ex-20261002-aaaaaaaaaaaa' });
    const search = await ctx.services.examples.searchReviewed({ query: 'customer ages' });
    assert.equal(search.results.length, 1);
    const r = search.results[0]!;
    assert.equal(r.validationStatus, 'human_reviewed_not_executed');
    assert.equal(r.review.reviewerIdentityVerified, false);
    assert.match(r.review.reviewerNameNote, /Self-reported/);
    assert.equal(r.source, 'examples/approved/ex-20261002-aaaaaaaaaaaa.json');
    assert.match(search.notice, /none has been executed/i);
  });

  it('skips malformed approved files with a warning', async () => {
    await writeApprovedFixture(ctx, { id: 'ex-20261002-aaaaaaaaaaaa' });
    await fs.writeFile(path.join(ctx.examplesDir, 'approved', 'ex-20261002-bbbbbbbbbbbb.json'), '{"status":"approved"}');
    const search = await ctx.services.examples.searchReviewed({ query: 'customer ages' });
    assert.equal(search.results.length, 1);
    assert.ok(search.warnings?.[0]?.includes('invalid'));
  });

  it('rejects a file in approved/ that claims another status', async () => {
    const fx = await writeApprovedFixture(ctx, { id: 'ex-20261002-aaaaaaaaaaaa' });
    const tampered = { ...fx, validationStatus: 'executed_ok' };
    await fs.writeFile(path.join(ctx.examplesDir, 'approved', `${fx.id}.json`), JSON.stringify(tampered));
    const search = await ctx.services.examples.searchReviewed({ query: 'customer ages' });
    assert.equal(search.results.length, 0);
  });
});

describe('interactive approval', () => {
  it('shows the full example and cancels unless the exact phrase is typed', async () => {
    const { pendingId } = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    for (const answer of ['y', 'yes', 'APPROVE', `approve ${pendingId}`, '']) {
      const io = scriptedIO(['Alex Reviewer', 'notes', answer]);
      const result = await ctx.services.review.approve(pendingId, io);
      assert.equal(result, null, `answer "${answer}" must not approve`);
      const shown = io.printed.join('\n');
      assert.ok(shown.includes(SAMPLE_SUBMISSION.sql), 'exact SQL displayed');
      assert.ok(shown.includes(SAMPLE_SUBMISSION.question));
      assert.ok(shown.includes('customer-search-rules'));
      assert.ok(shown.includes(SAMPLE_SUBMISSION.assumptions[0]!));
      assert.ok(shown.includes('Cancelled'));
    }
    assert.deepEqual(await files(ctx, 'approved'), []);
    assert.deepEqual(await files(ctx, 'pending'), [`${pendingId}.json`]);
  });

  it('requires a reviewer name', async () => {
    const { pendingId } = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    await assert.rejects(ctx.services.review.approve(pendingId, scriptedIO(['   '])), /Reviewer name is required/);
    assert.deepEqual(await files(ctx, 'approved'), []);
  });

  it('approves with the exact phrase and records full review metadata', async () => {
    const { pendingId } = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    const io = scriptedIO(['Alex Reviewer', 'Checked against rules', approvalPhrase(pendingId)]);
    const approved = await ctx.services.review.approve(pendingId, io);
    assert.ok(approved);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.validationStatus, 'human_reviewed_not_executed');
    assert.equal(approved.sql, SAMPLE_SUBMISSION.sql);
    assert.equal(approved.review.reviewerName, 'Alex Reviewer');
    assert.equal(approved.review.reviewerIdentityVerified, false);
    assert.equal(approved.review.notes, 'Checked against rules');
    assert.equal(approved.review.contextVersionAtReview, 'demo-2026-10-13.1');
    assert.ok(Date.parse(approved.review.reviewedAt) >= Date.parse(approved.createdAt));
    assert.deepEqual(await files(ctx, 'pending'), []);
    assert.deepEqual(await files(ctx, 'approved'), [`${pendingId}.json`]);
  });

  it('makes a newly approved example searchable on the next call without restart', async () => {
    const svc = ctx.services; // same long-lived instance, as in a running server
    const { pendingId } = await svc.examples.submit(SAMPLE_SUBMISSION);
    assert.equal((await svc.examples.searchReviewed({ query: 'postcode 0800' })).results.length, 0);

    // Approval happens in a separate process in real use; simulate with a separate service graph.
    const cli = createServices(ctx.config);
    await cli.review.approve(pendingId, scriptedIO(['Alex', '', approvalPhrase(pendingId)]));

    const after = await svc.examples.searchReviewed({ query: 'postcode 0800' });
    assert.equal(after.results.length, 1);
    assert.equal(after.results[0]!.id, pendingId);
    assert.equal((await svc.examples.getReviewed(pendingId)).example.id, pendingId);
  });
});

describe('duplicates and overwrites', () => {
  it('rejects an exact duplicate of a pending example', async () => {
    await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    await assert.rejects(
      ctx.services.examples.submit({ ...SAMPLE_SUBMISSION, question: `  ${SAMPLE_SUBMISSION.question.toUpperCase()} `, sql: `${SAMPLE_SUBMISSION.sql};\r\n` }),
      (e: Error) => e instanceof DuplicateExampleError && /already pending/.test(e.message),
    );
    assert.equal((await files(ctx, 'pending')).length, 1);
  });

  it('rejects an exact duplicate of an approved example', async () => {
    const { pendingId } = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    await ctx.services.review.approve(pendingId, scriptedIO(['A', '', approvalPhrase(pendingId)]));
    await assert.rejects(ctx.services.examples.submit(SAMPLE_SUBMISSION), /already approved/);
  });

  it('treats different SQL for the same question as a new example', async () => {
    await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    await ctx.services.examples.submit({ ...SAMPLE_SUBMISSION, sql: SAMPLE_SUBMISSION.sql.replace('COUNT(*)', 'COUNT(CUSTOMER_ID)') });
    assert.equal((await files(ctx, 'pending')).length, 2);
  });

  it('never overwrites an existing approved file and keeps the pending record', async () => {
    const { pendingId } = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    const squatter = path.join(ctx.examplesDir, 'approved', `${pendingId}.json`);
    await writeApprovedFixture(ctx, { id: pendingId, question: 'other', sql: 'SELECT 1 FROM APP.CUSTOMER_MASTER' });
    const before = await fs.readFile(squatter, 'utf8');
    await assert.rejects(
      ctx.services.review.approve(pendingId, scriptedIO(['A', '', approvalPhrase(pendingId)])),
      DuplicateExampleError,
    );
    assert.equal(await fs.readFile(squatter, 'utf8'), before);
    assert.deepEqual(await files(ctx, 'pending'), [`${pendingId}.json`]);
  });

  it('cannot approve the same pending example twice', async () => {
    const { pendingId } = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    await ctx.services.review.approve(pendingId, scriptedIO(['A', '', approvalPhrase(pendingId)]));
    await assert.rejects(ctx.services.review.approve(pendingId, scriptedIO([])), /No pending example/);
  });

  it('serialises concurrent identical submissions so exactly one succeeds', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createServices(ctx.config).examples.submit(SAMPLE_SUBMISSION)),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await files(ctx, 'pending')).length, 1);
  });

  it('accepts concurrent distinct submissions', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createServices(ctx.config).examples.submit({ ...SAMPLE_SUBMISSION, question: `${SAMPLE_SUBMISSION.question} #${i}` }),
      ),
    );
    assert.equal((await files(ctx, 'pending')).length, 5);
    const leftovers = (await fs.readdir(path.join(ctx.examplesDir, 'pending'))).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftovers, []);
  });
});

describe('rejection', () => {
  it('requires the exact phrase, keeps an audit record, and is never served', async () => {
    const { pendingId } = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    assert.equal(await ctx.services.review.reject(pendingId, scriptedIO(['R', 'wrong table', 'no'])), null);
    assert.deepEqual(await files(ctx, 'rejected'), []);

    const rejected = await ctx.services.review.reject(pendingId, scriptedIO(['R', 'wrong table', rejectionPhrase(pendingId)]));
    assert.ok(rejected);
    assert.equal(rejected.review.reason, 'wrong table');
    assert.deepEqual(await files(ctx, 'rejected'), [`${pendingId}.json`]);
    assert.deepEqual(await files(ctx, 'pending'), []);
    assert.equal((await ctx.services.examples.searchReviewed({ query: 'postcode 0800' })).results.length, 0);
    await assert.rejects(ctx.services.examples.getReviewed(pendingId), /is rejected, not approved/);
  });

  it('requires a reason', async () => {
    const { pendingId } = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    await assert.rejects(ctx.services.review.reject(pendingId, scriptedIO(['R', ''])), /Rejection reason is required/);
  });

  it('flags resubmission of previously rejected SQL', async () => {
    const { pendingId } = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    await ctx.services.review.reject(pendingId, scriptedIO(['R', 'bad', rejectionPhrase(pendingId)]));
    const again = await ctx.services.examples.submit(SAMPLE_SUBMISSION);
    assert.deepEqual(again.previouslyRejected, [pendingId]);
  });
});

describe('context-version staleness', () => {
  it('warns when an example was reviewed against an older context version', async () => {
    await writeApprovedFixture(ctx, { id: 'ex-20261002-aaaaaaaaaaaa' });
    let r = (await ctx.services.examples.searchReviewed({ query: 'customer ages' })).results[0]!;
    assert.equal(r.contextCheck.stale, false);

    const m = await readManifest(ctx);
    m.contextVersion = 'demo-2026-11-01.1';
    await writeManifest(ctx, m);

    r = (await ctx.services.examples.searchReviewed({ query: 'customer ages' })).results[0]!;
    assert.equal(r.contextCheck.stale, true);
    assert.match(r.contextCheck.warnings[0]!, /may be stale.*take precedence/);
  });

  it('warns when an example references tables or rules no longer documented', async () => {
    await writeApprovedFixture(ctx, { id: 'ex-20261002-aaaaaaaaaaaa', businessRuleIds: ['retired-rule'] });
    const r = (await ctx.services.examples.getReviewed('ex-20261002-aaaaaaaaaaaa')).example;
    assert.ok(r.contextCheck.warnings.some((w) => w.includes('retired-rule')));
  });
});

describe('demo seed', () => {
  it('copies the fictional demo into pending, labelled fictional, never approved', async () => {
    const ids = await ctx.services.review.seedDemo();
    assert.equal(ids.length, 1);
    const repo = new ExampleRepository(ctx.examplesDir, ctx.config.limits.maxFileBytes);
    const rec = await repo.get('pending', ids[0]!);
    assert.equal(rec.fictional, true);
    assert.equal(rec.submittedVia, 'demo-seed');
    assert.deepEqual(await files(ctx, 'approved'), []);
    await assert.rejects(ctx.services.review.seedDemo(), /already pending/);
  });
});
