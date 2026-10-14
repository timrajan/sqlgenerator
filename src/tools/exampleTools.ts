import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { EXAMPLE_ID_PATTERN, ExampleSubmissionSchema } from '../schemas.js';
import type { Services } from '../services/container.js';
import { domainId, searchQuery } from './contextTools.js';
import { toolResult } from './result.js';

export function registerExampleTools(server: McpServer, s: Services): void {
  const maxResults = s.config.limits.maxResults;

  server.registerTool(
    'search_reviewed_examples',
    {
      title: 'Search human-approved SQL examples',
      description:
        'Keyword search over APPROVED examples only (never pending or rejected). Returns question, SQL, rules used, ' +
        'assumptions, review metadata and a context-version check. Examples are patterns, not answers; none were executed.',
      inputSchema: z.object({
        query: searchQuery,
        domain: domainId.optional(),
        limit: z.number().int().min(1).max(maxResults).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, domain, limit }) =>
      toolResult('search_reviewed_examples', () => s.examples.searchReviewed({ query, domain, limit })),
  );

  server.registerTool(
    'get_reviewed_example',
    {
      title: 'Get one approved SQL example',
      description: 'Returns a complete APPROVED example by ID, including review metadata and staleness warnings.',
      inputSchema: z.object({ id: z.string().regex(EXAMPLE_ID_PATTERN).describe('Example ID, e.g. ex-20260101-0123456789ab.') }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => toolResult('get_reviewed_example', () => s.examples.getReviewed(id)),
  );

  server.registerTool(
    'submit_example_for_review',
    {
      title: 'Submit SQL example for human review (write)',
      description:
        'WRITE OPERATION. Only call when the user explicitly asks to submit a query for reuse. Saves a PENDING example ' +
        'to local storage; it cannot approve, and it never marks SQL as executed or tested. A human must approve it ' +
        'with the local review CLI before it becomes searchable.',
      inputSchema: ExampleSubmissionSchema.extend({
        question: ExampleSubmissionSchema.shape.question.describe('The original business question.'),
        sql: ExampleSubmissionSchema.shape.sql.describe('The exact SQL the user reviewed.'),
        domain: domainId,
        tables: ExampleSubmissionSchema.shape.tables.describe('Schema-qualified tables used, exactly as documented.'),
        businessRuleIds: ExampleSubmissionSchema.shape.businessRuleIds.describe('Business-rule document IDs applied.'),
        assumptions: ExampleSubmissionSchema.shape.assumptions.describe('Assumptions made; use [] if none.'),
        tags: ExampleSubmissionSchema.shape.tags.describe('Short search tags.'),
        notes: ExampleSubmissionSchema.shape.notes.describe('Optional notes for the reviewer.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => toolResult('submit_example_for_review', () => s.examples.submit(input)),
  );
}
