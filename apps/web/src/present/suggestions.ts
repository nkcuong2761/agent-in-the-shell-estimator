import type { Estimate, Role } from '@scopewise/shared';
import { roleWord } from '../copy';
import { addCalendarDays } from './dates';
import { formatDate } from './format';

/** Three follow-up chips generated from the estimate. */
export function toSuggestions(est: Estimate, deadline?: string): string[] {
  const byRole = new Map<Role, number>();
  for (const c of est.items) byRole.set(c.role, (byRole.get(c.role) ?? 0) + c.p50);
  const role = [...byRole.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'engineer';
  const longest = [...est.perPhase].sort((a, b) => b.endDayP50 - b.startDay - (a.endDayP50 - a.startDay))[0];
  const target = deadline ?? addCalendarDays(est.commitDate, -7);
  const out = [`What if we add another ${roleWord(role)}?`];
  if (longest) out.push(`Why does ${longest.name.toLowerCase()} take so long?`);
  out.push(`Can we finish by ${formatDate(target)}?`);
  return out;
}
