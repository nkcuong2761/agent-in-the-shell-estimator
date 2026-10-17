/** Working-day calendar helpers. Dates are ISO `YYYY-MM-DD`, interpreted in UTC. Weekends are skipped. */

export const HOURS_PER_DAY = 6;

function parse(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Move forward to a working day if `iso` falls on a weekend. */
export function nextWorkingDay(iso: string): string {
  const d = parse(iso);
  while (isWeekend(d)) d.setUTCDate(d.getUTCDate() + 1);
  return toISO(d);
}

/**
 * The date on which `days` working days of work finish, counting the start date as day 1.
 * Fractional days round up: 0.2 days of work still lands on the start date.
 */
export function addWorkingDays(startIso: string, days: number): string {
  const d = parse(nextWorkingDay(startIso));
  let remaining = Math.max(0, Math.ceil(days - 1e-9) - 1);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) remaining--;
  }
  return toISO(d);
}

/** Number of working days from start to end inclusive (0 if end is before start). */
export function workingDaysBetween(startIso: string, endIso: string): number {
  const s = parse(nextWorkingDay(startIso));
  const e = parse(endIso);
  if (e < s) return 0;
  let n = 0;
  const d = new Date(s);
  while (d <= e) {
    if (!isWeekend(d)) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

/** Working-day offset of `iso` relative to start (start = 0). Negative if before. */
export function workingDayOffset(startIso: string, iso: string): number {
  if (parse(iso) < parse(startIso)) return -workingDaysBetween(iso, startIso);
  return workingDaysBetween(startIso, iso) - 1;
}
