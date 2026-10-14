import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { ContextError, NotFoundError, UserFacingError } from '../errors.js';
import { ManifestSchema, type DocumentEntry, type Manifest, type TableEntry } from '../schemas.js';
import { readFileWithinRoot } from './safePath.js';

export const MANIFEST_FILE = 'manifest.json';

export interface LoadedDocument {
  entry: DocumentEntry;
  content: string;
  sha256: string;
}

export interface LoadedTable {
  entry: TableEntry;
  ddl: string;
  sha256: string;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `  - ${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

/**
 * Read-only access to the context directory (manifest, Markdown business
 * rules, DDL files). Files are re-read on each call so edits to context are
 * picked up without restarting the server; the files are small and capped.
 */
export class ContextRepository {
  constructor(private readonly config: AppConfig) {}

  get contextDir(): string {
    return this.config.contextDir;
  }

  async getManifest(): Promise<Manifest> {
    let raw: string;
    try {
      raw = await readFileWithinRoot(this.config.contextDir, MANIFEST_FILE, this.config.limits.maxFileBytes);
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new ContextError(
          `No ${MANIFEST_FILE} found in context directory ${this.config.contextDir}. ` +
            'Set SQLGEN_CONTEXT_DIR or create the manifest (see README "Replacing the demo context").',
        );
      }
      throw err;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new ContextError(`${MANIFEST_FILE} is not valid JSON: ${(err as Error).message}`);
    }
    const parsed = ManifestSchema.safeParse(json);
    if (!parsed.success) {
      throw new ContextError(`${MANIFEST_FILE} failed validation:\n${formatIssues(parsed.error)}`);
    }
    this.checkConsistency(parsed.data);
    return parsed.data;
  }

  private checkConsistency(m: Manifest): void {
    const problems: string[] = [];
    const domainIds = new Set<string>();
    for (const d of m.domains) {
      if (domainIds.has(d.id)) problems.push(`duplicate domain id "${d.id}"`);
      domainIds.add(d.id);
    }
    const tableNames = new Set<string>();
    for (const t of m.tables) {
      if (tableNames.has(t.name)) problems.push(`duplicate table "${t.name}"`);
      tableNames.add(t.name);
      if (!domainIds.has(t.domain)) problems.push(`table "${t.name}" references unknown domain "${t.domain}"`);
    }
    const docIds = new Set<string>();
    for (const doc of m.documents) {
      if (docIds.has(doc.id)) problems.push(`duplicate document id "${doc.id}"`);
      docIds.add(doc.id);
      if (!domainIds.has(doc.domain)) problems.push(`document "${doc.id}" references unknown domain "${doc.domain}"`);
    }
    if (problems.length > 0) {
      throw new ContextError(`${MANIFEST_FILE} is inconsistent:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    }
  }

  async requireDomain(domainId: string, manifest?: Manifest): Promise<Manifest['domains'][number]> {
    const m = manifest ?? (await this.getManifest());
    const domain = m.domains.find((d) => d.id === domainId);
    if (!domain) {
      throw new NotFoundError(
        `Unknown domain "${domainId}". Available domains: ${m.domains.map((d) => d.id).join(', ')}`,
      );
    }
    return domain;
  }

  async loadDocument(entry: DocumentEntry): Promise<LoadedDocument> {
    const content = await this.readContextFile(entry.path, `document "${entry.id}"`);
    return { entry, content, sha256: sha256(content) };
  }

  async loadTable(entry: TableEntry): Promise<LoadedTable> {
    const ddl = await this.readContextFile(entry.schemaPath, `table "${entry.name}"`);
    return { entry, ddl, sha256: sha256(ddl) };
  }

  /**
   * Finds a table by exact, case-sensitive name. Db2 delimited identifiers are
   * case-sensitive, so no silent case-folding: a near miss yields a suggestion.
   */
  findTable(manifest: Manifest, name: string): TableEntry {
    const exact = manifest.tables.find((t) => t.name === name);
    if (exact) return exact;
    const folded = manifest.tables.find((t) => t.name.toUpperCase() === name.toUpperCase());
    if (folded) {
      throw new NotFoundError(
        `Table "${name}" not found. Table names are matched exactly; did you mean "${folded.name}"?`,
      );
    }
    throw new NotFoundError(
      `Table "${name}" is not documented in the context. Documented tables: ${manifest.tables
        .map((t) => t.name)
        .join(', ')}`,
    );
  }

  private async readContextFile(relPath: string, label: string): Promise<string> {
    try {
      return await readFileWithinRoot(this.config.contextDir, relPath, this.config.limits.maxFileBytes);
    } catch (err) {
      if (err instanceof UserFacingError) {
        throw new ContextError(`Cannot read ${label} at "${relPath}": ${err.message}`);
      }
      throw err;
    }
  }
}
