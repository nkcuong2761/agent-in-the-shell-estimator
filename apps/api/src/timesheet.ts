/** CSV timesheet (`date,squad,role,hours`) → validated rows. Fallback source for worklogs when Jira has none. */
import { TimesheetRow } from '@scopewise/shared';
import { ApiError } from './errors';

export interface ParsedTimesheet {
  rows: TimesheetRow[];
  skipped: { line: number; reason: string }[];
}

const MAX_ROWS = 50_000;

export function parseTimesheetCsv(csv: string): ParsedTimesheet {
  const lines = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const idx = { date: header.indexOf('date'), squad: header.indexOf('squad'), role: header.indexOf('role'), hours: header.indexOf('hours') };
  if (Object.values(idx).some((i) => i < 0)) {
    throw new ApiError(400, 'bad_csv_header', 'The CSV needs a header row with the columns date, squad, role, hours.');
  }
  const rows: TimesheetRow[] = [];
  const skipped: ParsedTimesheet['skipped'] = [];
  for (let n = 1; n < lines.length; n++) {
    const raw = lines[n]?.trim();
    if (!raw) continue;
    if (rows.length >= MAX_ROWS) throw new ApiError(413, 'csv_too_large', `At most ${MAX_ROWS} rows per upload.`);
    const cells = raw.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const date = cells[idx.date] ?? '';
    const parsed = TimesheetRow.safeParse({
      date,
      squad: (cells[idx.squad] ?? '').toLowerCase(),
      role: (cells[idx.role] ?? '').toLowerCase(),
      hours: Number(cells[idx.hours]),
    });
    if (!parsed.success || !/^\d{4}-\d{2}-\d{2}/.test(date) || Number.isNaN(Date.parse(date.slice(0, 10)))) {
      skipped.push({ line: n + 1, reason: parsed.success ? 'date must be YYYY-MM-DD' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      continue;
    }
    rows.push(parsed.data);
  }
  return { rows, skipped };
}
