import type { Estimate, TeamShape } from '@scopewise/shared';
import { copy } from '../copy';
import { formatDate, formatSpan, formatWeeks, teamPhrase, weeksRange } from './format';

export type SureLevel = { label: string; bars: 1 | 2 | 3 };

export function howSure(confidence: Estimate['confidence']): SureLevel {
  return { label: copy.sure[confidence], bars: confidence === 'High' ? 3 : confidence === 'Medium' ? 2 : 1 };
}

/** Convert an amount of effort hours into working days on this schedule (hours scale with the P50 schedule). */
export function hoursToScheduleDays(est: Estimate, hours: number): number {
  if (est.total.p50 <= 0) return 0;
  return (hours / est.total.p50) * est.finishDays.p50;
}

export interface Headline {
  weeks: { low: number; high: number };
  range: string;
  team: string;
  mostLikely: string;
  safeDate: string;
  margin: string;
  sure: SureLevel;
  openQuestions: number;
}

export function toHeadline(est: Estimate, team: TeamShape): Headline {
  const weeks = weeksRange(est.finishDays.p50, est.finishDays.p80);
  const marginDays = Math.max(0, est.finishDays.commit - est.finishDays.p50);
  const open = est.rankedQuestions.length;
  return {
    weeks,
    range: formatWeeks(weeks.low, weeks.high),
    team: teamPhrase(team),
    mostLikely: formatDate(est.p50Date),
    safeDate: formatDate(est.commitDate),
    margin: formatSpan(marginDays),
    sure: howSure(est.confidence),
    openQuestions: open,
  };
}
