import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, type TestContext } from 'node:test';
import { readFileWithinRoot, resolveWithinRoot } from '../../src/repositories/safePath.js';
import { makeTempContext, readManifest, writeManifest, type TempContext } from '../helpers/tempContext.js';

let ctx: TempContext;
let outside: string;

beforeEach(async () => {
  ctx = await makeTempContext();
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlgen-outside-'));
  await fs.writeFile(path.join(outside, 'secret.txt'), 'SECRET');
});
afterEach(async () => {
  await ctx.cleanup();
  await fs.rm(outside, { recursive: true, force: true });
});

/** Creates a symlink, or skips the test where the OS/filesystem forbids it (e.g. Windows without privileges). */
async function symlinkOrSkip(t: TestContext, target: string, linkPath: string, type?: 'dir' | 'file'): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, type);
    return true;
  } catch (err) {
    t.skip(`symlinks unavailable: ${(err as Error).message}`);
    return false;
  }
}

describe('path traversal', () => {
  it('rejects ../ traversal', async () => {
    await assert.rejects(resolveWithinRoot(ctx.contextDir, '../outside.txt'), /escapes the context directory/);
    await assert.rejects(resolveWithinRoot(ctx.contextDir, 'schema/../../x'), /escapes the context directory/);
    await assert.rejects(resolveWithinRoot(ctx.contextDir, 'schema\\..\\..\\x'), /escapes the context directory/);
  });

  it('rejects absolute paths', async () => {
    await assert.rejects(resolveWithinRoot(ctx.contextDir, path.join(outside, 'secret.txt')), /must be relative/);
    await assert.rejects(resolveWithinRoot(ctx.contextDir, 'C:/Windows/win.ini'), /must be relative/);
  });

  it('rejects a manifest whose document path traverses out', async () => {
    const m = await readManifest(ctx);
    (m.documents as Record<string, unknown>[])[0]!.path = `../../${path.basename(outside)}/secret.txt`;
    await writeManifest(ctx, m);
    await assert.rejects(ctx.services.context.getBusinessRules('customer'), /escapes the context directory/);
  });
});

describe('symlink escapes', () => {
  it('rejects a file symlink pointing outside the root', async (t) => {
    const link = path.join(ctx.contextDir, 'business-rules', 'evil.md');
    if (!(await symlinkOrSkip(t, path.join(outside, 'secret.txt'), link, 'file'))) return;
    await assert.rejects(readFileWithinRoot(ctx.contextDir, 'business-rules/evil.md', 1000), /outside the context directory/);
  });

  it('rejects a directory symlink pointing outside the root', async (t) => {
    const link = path.join(ctx.contextDir, 'linked');
    if (!(await symlinkOrSkip(t, outside, link, 'dir'))) return;
    await assert.rejects(readFileWithinRoot(ctx.contextDir, 'linked/secret.txt', 1000), /outside the context directory/);
  });

  it('allows a symlink that stays inside the root', async (t) => {
    const link = path.join(ctx.contextDir, 'alias.sql');
    if (!(await symlinkOrSkip(t, path.join(ctx.contextDir, 'schema/customer/APP.CUSTOMER_MASTER.sql'), link, 'file'))) return;
    assert.match(await readFileWithinRoot(ctx.contextDir, 'alias.sql', 100_000), /CREATE TABLE APP\.CUSTOMER_MASTER/);
  });

  it('rejects an example store folder symlinked outside the examples root', async (t) => {
    const approved = path.join(ctx.examplesDir, 'approved');
    await fs.rm(approved, { recursive: true });
    if (!(await symlinkOrSkip(t, outside, approved, 'dir'))) return;
    await assert.rejects(
      ctx.services.examples.searchReviewed({ query: 'customer' }),
      /resolves outside/,
    );
  });
});
