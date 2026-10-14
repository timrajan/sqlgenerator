import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Project root, derived from this module's location rather than the
 * terminal's working directory. Works for both `src/config.ts` (tsx) and
 * `dist/config.js` (compiled), since both sit one level below the root.
 */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface Limits {
  /** Default number of search results when the caller gives no limit. */
  defaultResults: number;
  /** Hard cap on search results per call. */
  maxResults: number;
  /** Largest context/example file the server will read, in bytes. */
  maxFileBytes: number;
  /** Maximum characters returned per search excerpt. */
  maxExcerptChars: number;
  /** Maximum total characters of documents returned by get_business_rules. */
  maxRulesChars: number;
  /** Maximum number of tables per get_schema call. */
  maxTablesPerCall: number;
}

export interface AppConfig {
  projectRoot: string;
  /** Root of all schema/business context. Every file read must stay inside it. */
  contextDir: string;
  /** Root of the example store (approved/, pending/, rejected/, demo/). */
  examplesDir: string;
  limits: Limits;
}

export const DEFAULT_LIMITS: Limits = {
  defaultResults: 5,
  maxResults: 25,
  maxFileBytes: 512 * 1024,
  maxExcerptChars: 700,
  maxRulesChars: 120_000,
  maxTablesPerCall: 20,
};

function resolveFromRoot(value: string, root: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return n;
}

/**
 * Builds configuration from environment variables. Relative paths are
 * resolved against the project root, never the current working directory.
 *
 *   SQLGEN_CONTEXT_DIR   context root (default: <project>/context)
 *   SQLGEN_EXAMPLES_DIR  example store (default: <context>/examples)
 *   SQLGEN_DEFAULT_RESULTS, SQLGEN_MAX_RESULTS
 */
export function loadConfig(overrides: Partial<Omit<AppConfig, 'limits'>> & { limits?: Partial<Limits> } = {}): AppConfig {
  const projectRoot = overrides.projectRoot ?? PROJECT_ROOT;
  const contextDir =
    overrides.contextDir ?? resolveFromRoot(process.env.SQLGEN_CONTEXT_DIR ?? 'context', projectRoot);
  const examplesDir =
    overrides.examplesDir ??
    (process.env.SQLGEN_EXAMPLES_DIR
      ? resolveFromRoot(process.env.SQLGEN_EXAMPLES_DIR, projectRoot)
      : path.join(contextDir, 'examples'));

  const maxResults = intFromEnv('SQLGEN_MAX_RESULTS', DEFAULT_LIMITS.maxResults, 1, 100);
  const defaultResults = Math.min(
    intFromEnv('SQLGEN_DEFAULT_RESULTS', DEFAULT_LIMITS.defaultResults, 1, 100),
    maxResults,
  );

  return {
    projectRoot,
    contextDir,
    examplesDir,
    limits: { ...DEFAULT_LIMITS, maxResults, defaultResults, ...overrides.limits },
  };
}
