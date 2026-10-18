import { workingDaysBetween } from '@scopewise/engine';
import { formatDate } from './format';

export interface ProgressLine {
  text: string;
  /** 0–1 while the plan is under way; absent before the start and while estimating. */
  pct?: number;
  tone: 'muted' | 'ink' | 'warning';
}

/** Date-based progress for the sidebar: before the start, during the plan, or past the planned finish. */
export function progressLine(status: 'working' | 'ready' | 'error', startDate: string, planDays: number | undefined, today: string): ProgressLine {
  if (status === 'working') return { text: 'Estimating…', tone: 'muted' };
  if (status === 'error') return { text: 'Needs another try', tone: 'warning' };
  if (!planDays || planDays <= 0) return { text: 'No plan yet', tone: 'muted' };
  if (today < startDate) return { text: `Not started · starts ${formatDate(startDate)}`, tone: 'muted' };
  const elapsed = workingDaysBetween(startDate, today);
  const pct = elapsed / planDays;
  if (pct >= 1) return { text: 'Past the planned finish', pct: 1, tone: 'warning' };
  const totalWeeks = Math.max(1, Math.ceil(planDays / 5));
  const week = Math.min(totalWeeks, Math.max(1, Math.ceil(elapsed / 5)));
  return { text: `Week ${week} of ${totalWeeks} · ${Math.round(pct * 100)}%`, pct, tone: 'ink' };
}
