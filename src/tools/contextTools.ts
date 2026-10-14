import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { ID_PATTERN, INPUT_LIMITS, TABLE_NAME_PATTERN } from '../schemas.js';
import type { Services } from '../services/container.js';
import { toolResult } from './result.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const domainId = z.string().regex(ID_PATTERN).describe('Logical domain ID from list_domains, e.g. "customer".');
export const searchQuery = z.string().trim().min(1).max(INPUT_LIMITS.query).describe('Keywords or a business question.');

export function registerContextTools(server: McpServer, s: Services): void {
  const maxResults = s.config.limits.maxResults;
  const limit = z
    .number()
    .int()
    .min(1)
    .max(maxResults)
    .optional()
    .describe(`Maximum results (default ${s.config.limits.defaultResults}, max ${maxResults}).`);

  server.registerTool(
    'list_domains',
    {
      title: 'List business domains',
      description:
        'Lists the business domains documented for Db2 SQL generation, with their tables, business-rule document IDs, ' +
        'the context version and the Db2 platform (which may be "unspecified"). Start here.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => toolResult('list_domains', () => s.context.listDomains()),
  );

  server.registerTool(
    'search_context',
    {
      title: 'Search business rules and schema descriptions',
      description:
        'Deterministic keyword search over business-rule documents and table descriptions. Returns ranked, bounded ' +
        'excerpts with document IDs and source paths. Use get_business_rules / get_schema for full text.',
      inputSchema: z.object({ query: searchQuery, domain: domainId.optional(), limit }),
      annotations: READ_ONLY,
    },
    async ({ query, domain, limit }) => toolResult('search_context', () => s.context.searchContext({ query, domain, limit })),
  );

  server.registerTool(
    'get_business_rules',
    {
      title: 'Get business rules for a domain',
      description:
        'Returns the business-rule Markdown documents for one domain, with IDs, source paths and SHA-256 hashes. ' +
        'Current rules take precedence over any reviewed example.',
      inputSchema: z.object({ domain: domainId }),
      annotations: READ_ONLY,
    },
    async ({ domain }) => toolResult('get_business_rules', () => s.context.getBusinessRules(domain)),
  );

  server.registerTool(
    'get_schema',
    {
      title: 'Get table DDL',
      description:
        'Returns stored DDL for schema-qualified tables (e.g. "APP.CUSTOMER_MASTER"). Names are matched exactly, ' +
        'including case; near misses get a suggestion. Only documented tables are available.',
      inputSchema: z.object({
        tables: z
          .array(z.string().regex(TABLE_NAME_PATTERN, 'must be SCHEMA.TABLE'))
          .min(1)
          .max(s.config.limits.maxTablesPerCall)
          .describe('Schema-qualified table names.'),
      }),
      annotations: READ_ONLY,
    },
    async ({ tables }) => toolResult('get_schema', () => s.context.getSchema(tables)),
  );
}
