import type { CallToolResult } from '@modelcontextprotocol/server';
import { UserFacingError } from '../errors.js';
import { logger } from '../logger.js';

/** Wraps a tool handler: JSON text result on success, readable `isError` result on failure. */
export async function toolResult(name: string, fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    if (err instanceof UserFacingError) {
      logger.warn(`${name} rejected:`, err.message);
      return { isError: true, content: [{ type: 'text', text: `${name} failed: ${err.message}` }] };
    }
    logger.error(`${name} crashed:`, err);
    return {
      isError: true,
      content: [{ type: 'text', text: `${name} failed with an internal error. See the server's stderr log for details.` }],
    };
  }
}
