/**
 * MCP integration smoke test. Starts the COMPILED server (dist/server.js) as a
 * subprocess over stdio, using a temporary copy of the context so real example
 * storage is never touched. Run via `npm run test:smoke` (builds first).
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PROJECT_ROOT } from '../../src/config.js';
import { makeTempContext, SAMPLE_SUBMISSION, type TempContext } from '../helpers/tempContext.js';

const SERVER = path.join(PROJECT_ROOT, 'dist', 'server.js');

type TextResult = { content: { type: string; text?: string }[]; isError?: boolean };
const textOf = (r: unknown): string => (r as TextResult).content.map((c) => c.text ?? '').join('');
const jsonOf = <T = Record<string, unknown>>(r: unknown): T => JSON.parse(textOf(r)) as T;

describe('MCP stdio smoke test', () => {
  let ctx: TempContext;
  let client: Client;
  let transport: StdioClientTransport;
  const stderr: string[] = [];

  before(async () => {
    assert.ok(existsSync(SERVER), `Build first: ${SERVER} not found (npm run build)`);
    ctx = await makeTempContext();
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      cwd: ctx.root, // deliberately not the project root: paths must not depend on cwd
      env: { PATH: process.env.PATH ?? '', SQLGEN_CONTEXT_DIR: ctx.contextDir, SQLGEN_LOG_LEVEL: 'warn' },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (d: Buffer) => stderr.push(d.toString()));
    client = new Client({ name: 'sqlgenerator-smoke-test', version: '1.0.0' });
    await client.connect(transport);
  });

  after(async () => {
    await client?.close();
    await ctx?.cleanup();
  });

  it('completes initialization and identifies the server', () => {
    assert.equal(client.getServerVersion()?.name, 'sqlgenerator');
  });

  it('lists exactly the seven tools, with only submit marked as a write', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'get_business_rules',
      'get_reviewed_example',
      'get_schema',
      'list_domains',
      'search_context',
      'search_reviewed_examples',
      'submit_example_for_review',
    ]);
    for (const t of tools) {
      const expectReadOnly = t.name !== 'submit_example_for_review';
      assert.equal(t.annotations?.readOnlyHint, expectReadOnly, `${t.name} readOnlyHint`);
    }
    assert.ok(!names.some((n) => /approve|execute|run|shell/.test(n)), 'no approval/execution tool exposed');
  });

  it('serves context with provenance', async () => {
    const domains = jsonOf<{ domains: { id: string }[] }>(await client.callTool({ name: 'list_domains', arguments: {} }));
    assert.deepEqual(domains.domains.map((d) => d.id), ['customer']);

    const schema = jsonOf<{ tables: { table: string; sourcePath: string; ddl: string }[] }>(
      await client.callTool({ name: 'get_schema', arguments: { tables: ['APP.CUSTOMER_MASTER'] } }),
    );
    assert.equal(schema.tables[0]!.sourcePath, 'schema/customer/APP.CUSTOMER_MASTER.sql');
    assert.match(schema.tables[0]!.ddl, /RESIDENTIAL_POSTCODE\s+VARCHAR\(10\)/);

    const search = jsonOf<{ results: { id: string; sourcePath: string }[] }>(
      await client.callTool({ name: 'search_context', arguments: { query: 'age range inclusive', limit: 3 } }),
    );
    assert.ok(search.results.length > 0 && search.results.length <= 3);
    assert.ok(search.results.every((r) => r.id && r.sourcePath));
  });

  it('returns validation errors for bad input instead of crashing', async () => {
    const res = (await client.callTool({ name: 'get_schema', arguments: { tables: ['../../etc/passwd'] } })) as TextResult;
    assert.equal(res.isError, true);
  });

  it('submits a pending example that is not returned as approved', async () => {
    const submitted = jsonOf<{ pendingId: string; status: string }>(
      await client.callTool({ name: 'submit_example_for_review', arguments: SAMPLE_SUBMISSION }),
    );
    assert.equal(submitted.status, 'pending');
    assert.ok(existsSync(path.join(ctx.examplesDir, 'pending', `${submitted.pendingId}.json`)), 'written to temp storage');
    assert.deepEqual(await fs.readdir(path.join(ctx.examplesDir, 'approved')), []);

    const search = jsonOf<{ results: unknown[] }>(
      await client.callTool({ name: 'search_reviewed_examples', arguments: { query: 'postcode 0800 customers' } }),
    );
    assert.equal(search.results.length, 0);

    const get = (await client.callTool({ name: 'get_reviewed_example', arguments: { id: submitted.pendingId } })) as TextResult;
    assert.equal(get.isError, true);
    assert.match(textOf(get), /pending, not approved/);
  });

  it('keeps stdout clean (no protocol corruption logged)', () => {
    assert.ok(!stderr.join('').includes('ERROR'), stderr.join(''));
  });
});
