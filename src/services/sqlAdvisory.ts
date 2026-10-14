/**
 * ADVISORY-ONLY heuristics. These regex checks are a convenience for human
 * reviewers. They do not parse Db2 SQL and cannot prove a statement is valid,
 * read-only, or safe. Nothing here executes or validates against a database.
 */
export const ADVISORY_LABEL =
  'advisory-only regex checks; not a Db2 parser and not proof of validity or safety' as const;

const WRITE_OR_DDL = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|CREATE|ALTER|GRANT|REVOKE|CALL|EXECUTE|LOAD|IMPORT|EXPORT|REORG|RUNSTATS|SET)\b/i;

function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

export function advisoryLint(sql: string): { label: typeof ADVISORY_LABEL; warnings: string[] } {
  const warnings: string[] = [];
  const body = stripLiteralsAndComments(sql).trim();

  if (!/^(SELECT|WITH|VALUES)\b/i.test(body) && !/^\(\s*SELECT\b/i.test(body)) {
    warnings.push('Statement does not appear to start with SELECT, WITH or VALUES.');
  }
  const kw = body.match(WRITE_OR_DDL);
  if (kw) warnings.push(`Contains keyword "${kw[1]!.toUpperCase()}", which may indicate a non-read-only statement.`);

  const withoutTrailing = body.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) warnings.push('Appears to contain more than one statement.');

  if (/\bSELECT\s+\*/i.test(body)) warnings.push('Uses SELECT *; consider listing documented columns explicitly.');

  return { label: ADVISORY_LABEL, warnings };
}
