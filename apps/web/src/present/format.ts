import type { Role, TeamShape } from '@scopewise/shared';
import { roleWord } from '../copy';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parse = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "Fri 4 Dec" */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = parse(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "4 Dec 2026" */
export function formatLongDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = parse(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function halves(weeks: number): string {
  const whole = Math.floor(weeks);
  const half = weeks - whole >= 0.5;
  if (whole === 0) return '½';
  return `${whole}${half ? '½' : ''}`;
}

/** Working days → "a few days", "1 week", "1½ weeks", "3 weeks". */
export function formatDuration(workingDays: number): string {
  if (workingDays < 5) return 'a few days';
  const weeks = Math.round((workingDays / 5) * 2) / 2;
  const label = halves(weeks);
  return `${label} week${weeks === 1 ? '' : 's'}`;
}

/** A small amount of time in plain words, for margins and "could move this by". */
export function formatSpan(workingDays: number): string {
  if (workingDays < 1) return 'less than a day';
  if (workingDays < 1.5) return 'a day';
  if (workingDays < 4.5) return `${Math.round(workingDays)} days`;
  return formatDuration(workingDays).replace(/^1 week$/, 'a week');
}

/** X = P50 in weeks rounded to the nearest week; Y = P80 rounded up. Both at least 1, Y ≥ X. */
export function weeksRange(p50Days: number, p80Days: number): { low: number; high: number } {
  const low = Math.max(1, Math.round(p50Days / 5));
  const high = Math.max(low, Math.ceil(p80Days / 5));
  return { low, high };
}

export function formatWeeks(low: number, high: number): string {
  return low === high ? `${low} week${low === 1 ? '' : 's'}` : `${low}–${high} weeks`;
}

export function roundHours(h: number): number {
  if (h < 10) return Math.max(1, Math.round(h));
  return Math.round(h / 2) * 2;
}

const ROLE_ORDER: Role[] = ['pm', 'designer', 'engineer', 'qa', 'legal'];

/** "1 designer, 1 developer and 1 tester" */
export function teamPhrase(team: TeamShape): string {
  const parts = ROLE_ORDER.filter((r) => (team[r] ?? 0) > 0).map((r) => `${team[r]} ${roleWord(r, team[r])}`);
  if (parts.length <= 1) return parts[0] ?? 'nobody yet';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "About a 1 in 3 chance" style wording for a probability. */
export function chanceWords(p: number): string {
  if (p >= 0.95) return 'Almost certain';
  if (p >= 0.8) return 'Very likely (about 4 in 5 or better)';
  if (p >= 0.6) return 'Likely, about a 2 in 3 chance';
  if (p >= 0.4) return 'About an even chance';
  if (p >= 0.25) return 'About a 1 in 3 chance';
  if (p >= 0.15) return 'About a 1 in 5 chance';
  if (p >= 0.05) return 'About a 1 in 10 chance';
  return 'Very unlikely';
}

export function percentWords(fraction: number): string {
  const pct = Math.round(Math.abs(fraction) * 100);
  if (pct < 2) return 'about the same';
  return `about ${pct}% ${fraction > 0 ? 'more' : 'less'}`;
}
