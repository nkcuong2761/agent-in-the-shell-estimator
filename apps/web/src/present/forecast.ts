/**
 * The realistic forecast (6.7): the plan plus what is known to add time in this window. Three adjustments, each with
 * a title, a one-line source and a number of working days; the user can leave any of them out.
 */
import type { BufferRisk, DemoPostmortems, HistoryProject, PlannedLeave, ProjectType, Role, TeamShape } from '@scopewise/shared';
import { addWorkingDays, workingDaysBetween } from '@scopewise/engine';
import { roleWord } from '../copy';
import { copy } from '../copy';
import type { ForecastFlags } from '../state/policy';
import { formatDate } from './format';

export type AdjustmentId = keyof ForecastFlags;

export interface Adjustment {
  id: AdjustmentId;
  title: string;
  source: string;
  /** Whole working days. */
  days: number;
}

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** Planned leave that overlaps the plan window, scaled by the share of the role that is away. */
export function leaveAdjustment(leave: readonly PlannedLeave[], team: TeamShape, startDate: string, planDays: number): Adjustment | undefined {
  if (planDays <= 0) return undefined;
  const planFinish = addWorkingDays(startDate, planDays);
  let days = 0;
  const lines: string[] = [];
  for (const l of leave) {
    const from = later(startDate, l.start);
    const to = earlier(planFinish, l.end);
    if (to < from) continue;
    const overlap = workingDaysBetween(from, to);
    if (overlap <= 0) continue;
    const n = (team[l.role] ?? 0) > 0 ? (team[l.role] as number) : 1;
    days += (overlap * Math.min(l.people, n)) / n;
    lines.push(`${l.people} ${roleWord(l.role, l.people)} off ${formatDate(l.start)}–${formatDate(l.end)}`);
  }
  const whole = Math.round(days);
  if (whole <= 0) return undefined;
  return { id: 'leave', title: copy.adjLeave, source: lines.join(' · '), days: whole };
}

const CAUSE_WORDS = { blocked: 'client paused or blocked us', availability: 'time off during the project' } as const;

/**
 * Expected delay from finished projects of the same category: Σ over the "blocked" and "availability" causes of
 * (projects that saw it / n) × the average days it cost. Overrun hours convert at the squad's effective hours a day.
 */
export function historyAdjustment(pms: DemoPostmortems | null | undefined, projects: readonly HistoryProject[], projectType: ProjectType, hoursPerDay: number): Adjustment | undefined {
  if (!pms) return undefined;
  const byId = new Map(projects.filter((p) => p.projectType === projectType && p.status === 'closed').map((p) => [p.id, p]));
  const results = pms.results.filter((r) => byId.has(r.projectId));
  const n = results.length;
  if (!n) return undefined;
  let expected = 0;
  const lines: string[] = [];
  for (const cause of ['blocked', 'availability'] as const) {
    const costs = results
      .map((r) => r.findings.filter((f) => f.scope === 'item' && f.cause === cause && !f.suspectedDataError).reduce((s, f) => s + Math.max(0, f.actualH - f.estimateH), 0))
      .filter((h) => h > 0);
    if (!costs.length) continue;
    const avgDays = costs.reduce((a, b) => a + b, 0) / costs.length / Math.max(1, hoursPerDay);
    expected += (costs.length / n) * avgDays;
    lines.push(`${CAUSE_WORDS[cause]}: ${costs.length} of ${n} projects, ~${Math.max(1, Math.round(avgDays))} days`);
  }
  const whole = Math.round(expected);
  if (whole <= 0) return undefined;
  return { id: 'hist', title: copy.adjHist, source: lines.join(' · '), days: whole };
}

/** The risks-and-buffer factor expressed in working days on top of the plan. */
export function bufferAdjustment(planDays: number, f: number, risks: readonly BufferRisk[] | undefined, pct: number | undefined): Adjustment | undefined {
  if (f <= 1 || planDays <= 0) return undefined;
  const whole = Math.round(planDays * (f - 1));
  if (whole <= 0) return undefined;
  const parts = (risks ?? []).filter((r) => r.h > 0).map((r) => `${r.label || 'Unnamed risk'} (+${Math.round(r.h)} h)`);
  if (pct) parts.push(`${pct}% for the unknown`);
  return { id: 'buf', title: copy.adjBuf, source: parts.join(', '), days: whole };
}

export interface Forecast {
  planFinish: string;
  extraDays: number;
  realDays: number;
  realFinish: string;
  included: Adjustment[];
}

export function toForecast(startDate: string, planDays: number, adjustments: readonly Adjustment[], flags: ForecastFlags): Forecast {
  const included = adjustments.filter((a) => flags[a.id]);
  const extraDays = included.reduce((s, a) => s + a.days, 0);
  const realDays = planDays + extraDays;
  return { planFinish: addWorkingDays(startDate, planDays), extraDays, realDays, realFinish: addWorkingDays(startDate, realDays), included };
}

/** "Meets the due date" when the realistic finish is on or before it. */
export function meetsDue(realFinish: string, due: string | undefined): boolean | undefined {
  return due ? realFinish <= due : undefined;
}

export function roleLabel(role: Role, n: number): string {
  return roleWord(role, n === 1 ? 1 : 2);
}
