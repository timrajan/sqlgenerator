/**
 * Diagnostics go to stderr only. stdout is reserved for MCP JSON-RPC traffic
 * when running as a stdio server, so nothing in src/ may use console.log.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const env = (process.env.SQLGEN_LOG_LEVEL ?? 'info').toLowerCase() as Level;
  return ORDER[env] ?? ORDER.info;
}

function write(level: Level, message: string, detail?: unknown): void {
  if (ORDER[level] < threshold()) return;
  const suffix = detail === undefined ? '' : ` ${detail instanceof Error ? detail.message : JSON.stringify(detail)}`;
  process.stderr.write(`[sqlgenerator] ${level.toUpperCase()} ${message}${suffix}\n`);
}

export const logger = {
  debug: (m: string, d?: unknown) => write('debug', m, d),
  info: (m: string, d?: unknown) => write('info', m, d),
  warn: (m: string, d?: unknown) => write('warn', m, d),
  error: (m: string, d?: unknown) => write('error', m, d),
};
