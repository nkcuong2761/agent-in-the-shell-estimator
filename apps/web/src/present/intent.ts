/**
 * Rule-based follow-up parser for demo mode (live mode lets the Ask agent decide).
 * Keywords + role names + dates. It only decides what to compute; the engine does the computing.
 */
import type { Role, ScopeResult, TeamShape } from '@scopewise/shared';
import { ROLE_SYNONYMS, roleWord } from '../copy';

export type Intent =
  | { kind: 'team_what_if'; team: TeamShape; label: string; why: string; change: string }
  | { kind: 'drop_what_if'; itemIds: string[]; label: string; what: string }
  | { kind: 'deadline_check'; date: string }
  | { kind: 'explain'; phaseId: string }
  | { kind: 'new_info'; questionIds: string[]; note: string }
  | { kind: 'other' };

export interface IntentContext {
  scope: ScopeResult;
  team: TeamShape;
  /** ISO date that relative dates are resolved against (the kickoff date). */
  refDate: string;
  answeredQuestionIds?: string[];
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const STOP = new Set(['if', 'up', 'me', 'my', 'at', 'by', 'as', 'us', 'go', 'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'is', 'be', 'it', 'we', 'you', 'what', 'if', 'why', 'does', 'do', 'so', 'take', 'takes', 'long', 'can', 'could', 'should', 'with', 'without', 'skip', 'drop', 'cut', 'remove', 'leave', 'out', 'part', 'stage', 'work', 'how', 'come', 'that', 'this', 'there', 'they', 'client', 'says', 'said', 'needed', 'need', 'not', 'no', 'all', 'our', 'their', 'will', 'just', 'about', 'check']);

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');
const keyWords = (s: string) => new Set(tokens(s).filter((w) => w.length > 1 && !STOP.has(w)).map(stem));

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** Find a date in free text ("30 Nov", "Nov 30", "December 11th", "2026-11-30", "Fri 11 Dec"), on or after refDate. */
export function parseDate(text: string, refDate: string): string | undefined {
  const t = text.toLowerCase();
  const isoM = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (isoM) return iso(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3]));
  const monthNames = Object.keys(MONTHS).join('|');
  const dm = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\b`));
  const md = t.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  let day: number | undefined;
  let month: number | undefined;
  if (dm) {
    day = Number(dm[1]);
    month = MONTHS[dm[2] as string];
  } else if (md) {
    day = Number(md[2]);
    month = MONTHS[md[1] as string];
  }
  if (day === undefined || month === undefined || day < 1 || day > 31) return undefined;
  const ref = new Date(`${refDate}T00:00:00Z`);
  let year = ref.getUTCFullYear();
  if (iso(year, month, day) < refDate) year += 1;
  return iso(year, month, day);
}

function findRole(text: string): Role | undefined {
  const t = ` ${tokens(text).join(' ')} `;
  let best: { role: Role; at: number } | undefined;
  for (const [role, syns] of Object.entries(ROLE_SYNONYMS) as [Role, string[]][]) {
    for (const s of syns) {
      const at = t.indexOf(` ${s} `);
      if (at >= 0 && (!best || at < best.at)) best = { role, at };
    }
  }
  return best?.role;
}

function teamChange(text: string, ctx: IntentContext): Intent | undefined {
  const role = findRole(text);
  if (!role) return undefined;
  const t = tokens(text);
  const current = ctx.team[role] ?? 0;
  const roleIdx = t.findIndex((w) => ROLE_SYNONYMS[role].some((s) => s.split(' ')[0] === w));
  const before = t.slice(Math.max(0, roleIdx - 3), roleIdx);
  const numBefore = before.map((w) => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w])).filter((n): n is number => n !== undefined).pop();
  const adding = t.some((w) => ['add', 'another', 'more', 'extra', 'plus', 'hire', 'bring'].includes(w));
  const removing = t.some((w) => ['fewer', 'less', 'remove', 'lose', 'minus', 'without'].includes(w)) || /one (fewer|less)/.test(text);
  let next: number;
  if (removing) next = Math.max(0, current - (numBefore && numBefore > 1 ? numBefore : 1));
  else if (adding && t.includes('another')) next = current + 1;
  else if (adding) next = current + (numBefore ?? 1);
  else if (numBefore !== undefined && numBefore !== 1) next = numBefore;
  else if (numBefore === 1 && !t.includes('a') && !t.includes('an')) next = 1;
  else return undefined;
  const needed = ctx.scope.items.some((i) => i.role === role);
  if (needed) next = Math.max(1, next);
  if (next === current) return undefined;
  const team = { ...ctx.team, [role]: next };
  const more = next > current;
  return {
    kind: 'team_what_if',
    team,
    label: `With ${next} ${roleWord(role, next)}`,
    change: more ? `you added ${next - current === 1 ? 'a' : next - current} ${roleWord(role, next - current)}` : `you took ${current - next === 1 ? 'a' : current - next} ${roleWord(role, current - next)} off`,
    why: more ? `because ${next === 2 ? 'two' : next} ${roleWord(role, next)} need time to coordinate` : 'because fewer people need to coordinate',
  };
}

function matchPhase(text: string, scope: ScopeResult): string | undefined {
  const k = keyWords(text);
  let best: { id: string; score: number } | undefined;
  for (const ph of scope.phases) {
    const name = keyWords(ph.name);
    const itemWords = new Set(scope.items.filter((i) => i.phaseId === ph.id).flatMap((i) => [...keyWords(i.title)]));
    const score = [...name].filter((w) => k.has(w)).length * 3 + [...itemWords].filter((w) => k.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: ph.id, score };
  }
  return best?.id;
}

function matchItems(text: string, scope: ScopeResult): string[] {
  const k = keyWords(text);
  return scope.items.filter((i) => [...keyWords(i.title)].filter((w) => k.has(w)).length >= 1).map((i) => i.id);
}

function matchQuestions(text: string, ctx: IntentContext): string[] {
  const k = keyWords(text);
  const open = ctx.scope.missingInfo.filter((q) => !ctx.answeredQuestionIds?.includes(q.id));
  return open
    .map((q) => ({ id: q.id, score: [...keyWords(q.question)].filter((w) => k.has(w)).length }))
    .filter((q) => q.score >= 1)
    .sort((a, b) => b.score - a.score)
    .map((q) => q.id);
}

export function parseIntent(text: string, ctx: IntentContext): Intent {
  const t = text.toLowerCase();
  const date = parseDate(text, ctx.refDate);
  if (date && /\b(by|before|finish|done|deadline|ready|ship|launch|until|on)\b/.test(t)) return { kind: 'deadline_check', date };

  const newInfo = /\b(client|they)\s+(says?|said|told|confirmed|answered|wants?|replied)\b|\b(confirmed|answer(ed)?s?)\b|^(yes|no)\b/.test(t);
  if (newInfo) return { kind: 'new_info', questionIds: matchQuestions(text, ctx).slice(0, 2), note: text.trim() };

  if (/\b(what if|add|another|more|extra|fewer|less|hire|instead of)\b/.test(t) || /\b\d+\s+\w+s\b/.test(t)) {
    const team = teamChange(text, ctx);
    if (team) return team;
  }

  if (/\b(skip|drop|without|cut|remove|leave out|no need for|don'?t do|exclude)\b/.test(t)) {
    const phaseId = matchPhase(text, ctx.scope);
    const phaseName = ctx.scope.phases.find((p) => p.id === phaseId)?.name;
    const phaseWords = phaseName ? keyWords(phaseName) : new Set<string>();
    const k = keyWords(text);
    if (phaseId && phaseName && [...phaseWords].some((w) => k.has(w))) {
      return { kind: 'drop_what_if', itemIds: ctx.scope.items.filter((i) => i.phaseId === phaseId).map((i) => i.id), label: `Without ${phaseName.toLowerCase()}`, what: phaseName.toLowerCase() };
    }
    const items = matchItems(text, ctx.scope);
    if (items.length) {
      const first = ctx.scope.items.find((i) => i.id === items[0])?.title ?? 'that work';
      return { kind: 'drop_what_if', itemIds: items, label: `Without ${items.length === 1 ? first.toLowerCase() : 'those parts'}`, what: items.length === 1 ? first.toLowerCase() : `${items.length} pieces of work` };
    }
  }

  if (/\b(why|how come|explain|so long|take so|takes so|what's in|what is in)\b/.test(t)) {
    const phaseId = matchPhase(text, ctx.scope);
    if (phaseId) return { kind: 'explain', phaseId };
  }

  const qs = matchQuestions(text, ctx);
  if (qs.length && /\b(no|yes|only|just|not|don'?t|won'?t|will|we'?ll|confirmed)\b/.test(t)) return { kind: 'new_info', questionIds: qs.slice(0, 2), note: text.trim() };

  return { kind: 'other' };
}
