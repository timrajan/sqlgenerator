/**
 * Deterministic keyword scoring used by all search tools. No embeddings or
 * external services: the same inputs always produce the same ranking.
 */

const STOPWORDS = new Set(
  'a an and are as at be by for from get give how i in is it list me of on or show the to what which who with all their there this that do does any find'.split(' '),
);

/**
 * Lower-cases and splits on non-identifier characters. Identifiers such as
 * CUSTOMER_MASTER yield both the whole token and its parts, so "customer
 * master" matches the table name.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (!raw) continue;
    if (!STOPWORDS.has(raw)) out.push(raw);
    if (raw.includes('_')) {
      for (const part of raw.split('_')) if (part && !STOPWORDS.has(part)) out.push(part);
    }
  }
  return out;
}

export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))].sort();
}

export interface WeightedField {
  text: string;
  weight: number;
}

/**
 * Score = (Σ over query terms of Σ over fields of weight × log2(1 + tf))
 *         × (matched terms / query terms)
 * The coverage factor favours documents matching more distinct terms.
 */
export function scoreFields(terms: string[], fields: WeightedField[]): { score: number; matched: string[] } {
  if (terms.length === 0) return { score: 0, matched: [] };
  const counts = fields.map((f) => {
    const m = new Map<string, number>();
    for (const t of tokenize(f.text)) m.set(t, (m.get(t) ?? 0) + 1);
    return { weight: f.weight, m };
  });
  let raw = 0;
  const matched: string[] = [];
  for (const term of terms) {
    let termScore = 0;
    for (const { weight, m } of counts) {
      const tf = m.get(term) ?? 0;
      if (tf > 0) termScore += weight * Math.log2(1 + tf);
    }
    if (termScore > 0) matched.push(term);
    raw += termScore;
  }
  const score = raw * (matched.length / terms.length);
  return { score: Math.round(score * 1e4) / 1e4, matched };
}

/** Stable ordering: score desc, then the provided tie-break key asc. */
export function rank<T>(items: T[], score: (t: T) => number, key: (t: T) => string): T[] {
  return [...items].sort((a, b) => score(b) - score(a) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export function excerpt(text: string, terms: string[], maxChars: number): string {
  const clean = text.replace(/\s+\n/g, '\n').trim();
  if (clean.length <= maxChars) return clean;
  const lower = clean.toLowerCase();
  let first = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  const start = Math.max(0, first < 0 ? 0 : first - Math.floor(maxChars / 4));
  const slice = clean.slice(start, start + maxChars);
  return `${start > 0 ? '…' : ''}${slice}${start + maxChars < clean.length ? '…' : ''}`;
}

export interface MarkdownSection {
  heading: string;
  body: string;
  index: number;
}

/** Splits Markdown into sections on #/##/### headings so excerpts stay focused. */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let heading = '';
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body || heading) sections.push({ heading, body, index: sections.length });
    buf = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[2]!.trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}
