import type { Estimate } from '@scopewise/shared';
import { copy } from '../copy';
import { formatDate, formatSpan, formatWeeks, percentWords, weeksRange } from './format';

export interface Comparison {
  summary: string;
  rows: { label: string; current: string; proposed: string }[];
}

/**
 * Compare two estimates in plain words. `why` explains the change in total effort (for example
 * "because two developers need time to coordinate").
 */
export function toComparison(a: Estimate, b: Estimate, why?: string): Comparison {
  const wa = weeksRange(a.finishDays.p50, a.finishDays.p80);
  const wb = weeksRange(b.finishDays.p50, b.finishDays.p80);
  const dayDiff = b.finishDays.p50 - a.finishDays.p50;
  const effort = (b.total.p50 - a.total.p50) / Math.max(1, a.total.p50);
  const when =
    Math.abs(dayDiff) < 2
      ? 'You would likely finish at about the same time.'
      : `You'd likely finish about ${formatSpan(Math.abs(dayDiff))} ${dayDiff < 0 ? 'sooner' : 'later'}.`;
  const effortLine =
    Math.abs(effort) < 0.02
      ? ''
      : ` The team would spend ${effort > 0 ? 'a bit more' : 'less'} time in total${why ? `, ${why}` : ''}.`;
  return {
    summary: when + effortLine,
    rows: [
      { label: copy.rowTakes, current: formatWeeks(wa.low, wa.high), proposed: formatWeeks(wb.low, wb.high) },
      { label: copy.rowLikely, current: formatDate(a.p50Date), proposed: formatDate(b.p50Date) },
      { label: copy.rowSafe, current: formatDate(a.commitDate), proposed: formatDate(b.commitDate) },
      { label: copy.rowTeamTime, current: '', proposed: percentWords(effort) },
    ],
  };
}
