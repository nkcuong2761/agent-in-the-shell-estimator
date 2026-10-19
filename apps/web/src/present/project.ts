import type { BacktestPoint, HistoryProject, LessonCause, PostmortemResult, RealProject, Role } from '@scopewise/shared';
import { ROLE_LABELS } from '@scopewise/shared';
import { CATEGORY_WORDS, copy } from '../copy';
import { formatDate, formatLongDate, formatWeeks } from './format';

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

/** The lesson in one forward-looking sentence, built from its cause and the kind of work it applies to. */
export function toLesson(pm: PostmortemResult | undefined, project?: HistoryProject): { text: string; addsRule: boolean } | undefined {
  const l = pm?.lessons[0];
  if (!l) return undefined;
  const finding = pm?.findings.find((f) => f.scope === 'item' && f.note === l.note);
  const what = finding?.title.toLowerCase() ?? (l.appliesTo.category ? CATEGORY_WORDS[l.appliesTo.category] : 'this kind of work');
  const kind = project ? PROJECT_WORDS[project.projectType] : 'similar projects';
  const text: Record<LessonCause, string> = {
    'scope-added': `${capitalise(what)} tends to be added after kickoff on ${kind}, so I now ask about it before giving a date.`,
    underestimated: `Work like ${what} takes longer than it looks on ${kind}, so I now allow more time for it.`,
    blocked: `${capitalise(what)} waited on another team, so I now check who owns access and sign-off before build starts.`,
    availability: `Planned time off overlapped this work, so I now plan around known leave dates.`,
    'data-error': `One time entry looked wrong, so I left it out when learning from this project.`,
  };
  return { text: text[l.cause], addsRule: l.cause === 'scope-added' };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const PROJECT_WORDS: Record<HistoryProject['projectType'], string> = {
  'new-feature': 'new features',
  'form-digitization': 'form projects',
  integration: 'integrations',
  'data-migration': 'data migrations',
  reporting: 'reporting projects',
};

export interface Improvement {
  bars: { projectId: string; offPct: number; highlight: boolean }[];
  sentence: string;
  /** How this project's bar was worked out, in words. */
  detail?: string;
}

/** How far a dates-only ticket was off, on calendar time: the gap between the weeks it took and the middle of what we said. */
export function calendarOffPct(o: ProjectOutcome): number {
  const mid = (o.said.low + o.said.high) / 2;
  return Math.round((Math.abs(o.tookWeeks - mid) / Math.max(1, mid)) * 100);
}

/**
 * Error per finished project, oldest first, with a sentence computed from the data. Hour-based projects come from
 * the backtest; a dates-only ticket (no hours in Jira) gets a calendar-time bar at its place in time.
 */
export function toImprovement(points: readonly BacktestPoint[], current?: { project: HistoryProject; point: BacktestPoint; outcome: ProjectOutcome }): Improvement {
  const bars = points.map((p) => ({ projectId: p.projectId, offPct: Math.round(p.calibratedMRE * 100), highlight: p.projectId === current?.project.id, endDate: '' }));
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const early = mean(bars.slice(0, 5).map((b) => b.offPct));
  const late = mean(bars.slice(-5).map((b) => b.offPct));
  let detail: string | undefined;
  if (current) {
    const o = current.outcome;
    const datesOnly = current.project.labels.includes('dates-only');
    if (datesOnly) {
      const offPct = calendarOffPct(o);
      bars.push({ projectId: current.project.id, offPct, highlight: true, endDate: current.project.endDate });
      detail = copy.barDetailDates(o.said.text, o.took, offPct);
    } else {
      const offPct = Math.round(current.point.calibratedMRE * 100);
      detail = copy.barDetailHours(Math.round(current.point.calibratedP50), Math.round(current.point.actualH), offPct, o.said.text, o.took);
    }
  }
  return { bars: bars.map(({ endDate: _e, ...b }) => b), sentence: copy.improvement(early, late), detail };
}

/** Questions to ask the user when a finished ticket cannot explain itself (no hours logged, nothing to compare). */
export interface Clarify {
  intro: string;
  hoursQuestion: string;
  causeQuestion: string;
  noteQuestion: string;
}

export function toClarify(rp: RealProject, o: ProjectOutcome): Clarify {
  const diff = o.tookWeeks - (o.said.low + o.said.high) / 2;
  const direction = Math.abs(diff) < 1 ? 'about as long as' : diff < 0 ? 'less time than' : 'more time than';
  return {
    intro: copy.clarifyIntro(o.took, direction, o.said.text),
    hoursQuestion: copy.clarifyHours,
    causeQuestion: copy.clarifyCause,
    noteQuestion: copy.clarifyNote,
  };
}

export function finishedLine(project: HistoryProject): string {
  return copy.projectFinished(formatLongDate(project.endDate));
}

// --- real tickets imported from Jira ----------------------------------------------------------------

export interface RealFacts {
  /** Hours are absent on a dates-only ticket (nothing was logged in Jira). */
  hours?: { estimateH: number; actualH: number };
  hindsightH: number;
  started: string;
  finished: string;
  hindsight: string;
  roles: string;
  verdict: string;
  second?: string;
}

const weeksWord = (n: number) => `${n} week${n === 1 ? '' : 's'}`;
/** Hours a week one person puts into project work (6 productive hours × 5 days, at a typical focus factor). */
const HOURS_PER_PERSON_WEEK = 24;

/**
 * Fixed facts for a finished ticket: what Jira said, what was logged, what the engine would have said with only
 * earlier history (the backtest point), and one or two plain sentences on whether it could have finished sooner.
 */
export function toRealFacts(rp: RealProject, point: BacktestPoint, o: ProjectOutcome): RealFacts {
  const p = rp.project;
  const roles = [...new Set(rp.items.map((i) => i.role))] as Role[];
  const roleText = roles.map((r) => ROLE_LABELS[r].toLowerCase()).join(', ') || 'the team';
  const diff = o.tookWeeks - o.said.high;
  const verdict = o.tookWeeks <= o.said.low ? copy.verdictSooner(weeksWord(Math.max(1, o.said.low - o.tookWeeks))) : diff <= 0 ? copy.verdictWithin : copy.verdictLater(weeksWord(diff));
  const datesOnly = p.labels.includes('dates-only');
  const fitsWeeks = Math.max(1, Math.ceil(p.actualH / (HOURS_PER_PERSON_WEEK * Math.max(1, roles.length))));
  let second: string | undefined;
  if (datesOnly) second = undefined;
  else if (o.tookWeeks > fitsWeeks + 1) {
    const causes = [...new Set(rp.postmortem.findings.filter((f) => f.cause === 'blocked' || f.cause === 'availability').map((f) => (f.cause === 'blocked' ? 'waiting on others' : 'time off')))].join(' and ');
    second = copy.verdictWaiting(Math.round(p.actualH), weeksWord(fitsWeeks), causes);
  } else if (o.tookWeeks < fitsWeeks - 1) second = copy.verdictPacked(Math.round(p.actualH), weeksWord(o.tookWeeks));
  return {
    hours: datesOnly ? undefined : { estimateH: Math.round(p.estimateH), actualH: Math.round(p.actualH) },
    hindsightH: Math.round(point.calibratedP50),
    started: copy.startedOn(formatDate(p.startDate)),
    finished: copy.finishedOnDate(formatDate(p.endDate)),
    hindsight: copy.hindsightDates(formatDate(point.calibratedP50Date), formatDate(point.calibratedP80Date)),
    roles: datesOnly ? copy.datesOnlyNote : copy.rolesInvolved(roleText),
    verdict,
    second,
  };
}
