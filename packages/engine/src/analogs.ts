import type { Analog, HistoryItem, HistoryProject, ItemAnalogs, WorkItem } from '@scopewise/shared';
import { CITATIONS, type Explained } from './explain';
import { noOverhead, type OverheadLookup } from './overhead';
import { median, round } from './stats';
import { TfIdf, cosine } from './tfidf';

export const ANALOG_K = 3;
/** Items whose time spent is this many times their estimate are treated as data-entry errors and skipped. */
export const DATA_ERROR_RATIO = 8;

export function isSuspectedDataError(item: Pick<HistoryItem, 'originalEstimateH' | 'timeSpentH'>): boolean {
  if (item.originalEstimateH <= 0) return false;
  const r = item.timeSpentH / item.originalEstimateH;
  return r >= DATA_ERROR_RATIO || r <= 1 / DATA_ERROR_RATIO;
}

export interface AnalogIndex {
  pool: HistoryItem[];
  overhead: OverheadLookup;
  tfidf: TfIdf;
  vectors: Map<string, ReturnType<TfIdf['vector']>>;
}

/** Build a similarity index over closed, plausible history items. */
export function buildAnalogIndex(
  items: readonly HistoryItem[],
  projects: readonly HistoryProject[],
  overhead: OverheadLookup = noOverhead,
): AnalogIndex {
  const closed = new Set(projects.filter((p) => p.status === 'closed').map((p) => p.id));
  const pool = items.filter((i) => closed.has(i.projectId) && !isSuspectedDataError(i));
  const tfidf = new TfIdf(pool.map((i) => i.title));
  const vectors = new Map(pool.map((i) => [i.id, tfidf.vector(i.title)]));
  return { pool, overhead, tfidf, vectors };
}

/**
 * k most similar closed items: same category first, then same complexity, then TF-IDF cosine on the title.
 * Falls back to other categories only when the category has fewer than k items.
 */
export function findAnalogs(
  item: Pick<WorkItem, 'id' | 'title' | 'category' | 'complexity'>,
  index: AnalogIndex,
  k = ANALOG_K,
): Explained<ItemAnalogs> {
  const v = index.tfidf.vector(item.title);
  const scored = index.pool.map((h) => ({
    h,
    cat: h.category === item.category ? 1 : 0,
    cx: h.complexity === item.complexity ? 1 : 0,
    sim: cosine(v, index.vectors.get(h.id) ?? new Map()),
  }));
  scored.sort((a, b) => b.cat - a.cat || b.cx - a.cx || b.sim - a.sim || a.h.id.localeCompare(b.h.id));
  const matches: Analog[] = scored.slice(0, k).map(({ h, sim }) => ({
    historyItemId: h.id,
    projectId: h.projectId,
    title: h.title,
    // Overhead-free actual, so it compares with a single-person panel guess.
    actualH: round(h.timeSpentH / index.overhead(h), 2),
    estimateH: h.originalEstimateH,
    similarity: round(sim, 3),
  }));
  const actuals = matches.map((m) => m.actualH);
  return {
    value: { itemId: item.id, matches },
    explanation: {
      method: 'Estimation by analogy (k nearest neighbours)',
      citation: CITATIONS.analogy,
      plainWords:
        matches.length === 0
          ? 'No closed items to compare with yet.'
          : `The ${matches.length} most similar past items took ${actuals.map((a) => round(a)).join(', ')} hours (median ${round(median(actuals))}).`,
      formula: 'rank by same category, then same complexity, then TF-IDF cosine(title); take top k = 3',
      inputs: { k, category: item.category, complexity: item.complexity, poolSize: index.pool.length },
    },
  };
}
