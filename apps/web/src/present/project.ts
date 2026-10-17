import type { BacktestPoint, HistoryProject, PostmortemResult } from '@scopewise/shared';
import { copy } from '../copy';
import { formatLongDate, formatWeeks } from './format';

const weeksBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (7 * 864e5);

export interface ProjectOutcome {
  said: { low: number; high: number; text: string };
  tookWeeks: number;
  took: string;
  onTime: boolean;
  sentence: string;
}

/** What we said at kickoff (engine replayed with only earlier history) against how long it really took. */
export function toOutcome(project: HistoryProject, point: BacktestPoint): ProjectOutcome {
  const low = Math.max(1, Math.round(weeksBetween(project.startDate, point.calibratedP50Date)));
  const high = Math.max(low, Math.ceil(weeksBetween(project.startDate, point.calibratedP80Date)));
  const tookWeeks = Math.max(1, Math.round(weeksBetween(project.startDate, project.endDate)));
  const said = formatWeeks(low, high);
  const took = `${tookWeeks} week${tookWeeks === 1 ? '' : 's'}`;
  const onTime = tookWeeks <= high;
  return { said: { low, high, text: said }, tookWeeks, took, onTime, sentence: onTime ? copy.onTime(said) : copy.weSaid(said, took) };
}

export function sidebarLine(o: ProjectOutcome): { text: string; tone: 'success' | 'warning' } {
  return o.onTime ? { text: copy.sideOnTime(o.said.text), tone: 'success' } : { text: copy.sideTook(o.took, o.said.text.replace(/ weeks?$/, '')), tone: 'warning' };
}

/** 1–3 plain bullets from the post-mortem, biggest gaps first. */
export function toHappened(pm: PostmortemResult | undefined): string[] {
  if (!pm) return [];
  return pm.findings
    .filter((f) => f.scope === 'item')
    .sort((a, b) => b.actualH - b.estimateH - (a.actualH - a.estimateH))
    .slice(0, 3)
    .map((f) => f.note)
    .filter(Boolean);
}

export function toLesson(pm: PostmortemResult | undefined): { text: string; addsRule: boolean } | undefined {
  const l = pm?.lessons[0];
  if (!l) return undefined;
  return { text: l.note, addsRule: l.cause === 'scope-added' };
}

export interface Improvement {
  bars: { projectId: string; offPct: number; highlight: boolean }[];
  sentence: string;
}

/** Backtest error per finished project, oldest first, with a sentence computed from the data. */
export function toImprovement(points: readonly BacktestPoint[], projectId?: string): Improvement {
  const bars = points.map((p) => ({ projectId: p.projectId, offPct: Math.round(p.calibratedMRE * 100), highlight: p.projectId === projectId }));
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const early = mean(bars.slice(0, 5).map((b) => b.offPct));
  const late = mean(bars.slice(-5).map((b) => b.offPct));
  return { bars, sentence: copy.improvement(early, late) };
}

export function finishedLine(project: HistoryProject): string {
  return copy.projectFinished(formatLongDate(project.endDate));
}
