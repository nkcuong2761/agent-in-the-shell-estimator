/** Tiny TF-IDF + cosine similarity for short work-item titles. */

const STOP = new Set([
  'a', 'an', 'and', 'the', 'of', 'to', 'for', 'in', 'on', 'with', 'by', 'from', 'into', 'at', 'or', 'is', 'be', 'as', 'new', 'add',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));
}

export type SparseVector = Map<string, number>;

export class TfIdf {
  private readonly idf = new Map<string, number>();
  private readonly docCount: number;

  constructor(docs: readonly string[]) {
    this.docCount = docs.length;
    const df = new Map<string, number>();
    for (const doc of docs) {
      for (const term of new Set(tokenize(doc))) df.set(term, (df.get(term) ?? 0) + 1);
    }
    for (const [term, count] of df) this.idf.set(term, Math.log((1 + this.docCount) / (1 + count)) + 1);
  }

  vector(text: string): SparseVector {
    const tf = new Map<string, number>();
    const tokens = tokenize(text);
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: SparseVector = new Map();
    const unseen = Math.log(1 + this.docCount) + 1;
    for (const [t, c] of tf) v.set(t, (c / tokens.length) * (this.idf.get(t) ?? unseen));
    return v;
  }
}

export function cosine(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [t, x] of a) {
    na += x * x;
    const y = b.get(t);
    if (y !== undefined) dot += x * y;
  }
  for (const y of b.values()) nb += y * y;
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
