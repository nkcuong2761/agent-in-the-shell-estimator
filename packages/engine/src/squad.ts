import type { SquadStats, Worklog } from '@scopewise/shared';
import { CITATIONS, type Explained } from './explain';
import { round } from './stats';

export const DEFAULT_SQUAD_STATS: SquadStats = { focusFactor: 0.75, absenceRate: 0.08, coordinationOverheadPerExtra: 0.1 };

/**
 * Derive focus factor and absence rate from weekly worklogs.
 * absence = Σ absence / Σ planned; focus = Σ logged / Σ (planned − absence).
 */
export function squadStatsFromWorklogs(
  worklogs: readonly Worklog[],
  squad: string,
  coordinationOverheadPerExtra = DEFAULT_SQUAD_STATS.coordinationOverheadPerExtra,
): Explained<SquadStats> {
  const rows = worklogs.filter((w) => w.squad === squad);
  let planned = 0;
  let logged = 0;
  let absence = 0;
  for (const r of rows) {
    planned += r.plannedH;
    logged += r.loggedH;
    absence += r.absenceH;
  }
  const value: SquadStats =
    planned > 0
      ? {
          focusFactor: round(Math.min(1, Math.max(0.1, logged / Math.max(1, planned - absence))), 3),
          absenceRate: round(Math.min(0.5, absence / planned), 3),
          coordinationOverheadPerExtra,
        }
      : DEFAULT_SQUAD_STATS;
  return {
    value,
    explanation: {
      method: 'Capacity from worklogs',
      citation: `${CITATIONS.brooks}; worklog convention from Jira`,
      plainWords:
        planned > 0
          ? `Over ${rows.length} role-weeks, ${Math.round(value.absenceRate * 100)}% of planned hours were lost to absence and ${Math.round(value.focusFactor * 100)}% of the rest went to project work.`
          : 'No worklogs for this squad, so default capacity assumptions are used.',
      formula: 'absence = Σabsence / Σplanned; focus = Σlogged / Σ(planned − absence)',
      inputs: { squad, roleWeeks: rows.length, plannedH: round(planned), loggedH: round(logged), absenceH: round(absence) },
    },
  };
}

/** Parse a `date, squad, role, hours` CSV timesheet into weekly worklogs (fallback when Jira worklogs are missing). */
export function worklogsFromTimesheet(
  rows: readonly { date: string; squad: string; role: Worklog['role']; hours: number }[],
  headcount: (squad: string, role: Worklog['role']) => number,
  hoursPerWeek = 40,
): Worklog[] {
  const byKey = new Map<string, Worklog>();
  for (const r of rows) {
    const weekStart = mondayOf(r.date);
    const key = `${r.squad}|${r.role}|${weekStart}`;
    const existing = byKey.get(key);
    if (existing) existing.loggedH += r.hours;
    else {
      const planned = headcount(r.squad, r.role) * hoursPerWeek;
      byKey.set(key, { squad: r.squad, role: r.role, weekStart, plannedH: planned, loggedH: r.hours, absenceH: 0 });
    }
  }
  // Without absence data, treat any shortfall beyond a 25% non-project allowance as absence.
  for (const w of byKey.values()) w.absenceH = round(Math.max(0, w.plannedH * 0.75 - w.loggedH) * 0.5, 1);
  return [...byKey.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}
