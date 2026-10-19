import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BriefPack, Conversation, EstimateSpec, Message, ProgressStep, ScopeResult, TeamShape } from '@scopewise/shared';
import { ConversationStore } from '@scopewise/shared';
import { copy, roleWord, SOURCE_LABELS } from '../copy';
import { api, detectMode, type Mode } from '../lib/api';
import { samples, seed } from '../lib/data';
import { readStore, writeStore } from '../lib/storage';
import { chanceWords, formatDate, formatDuration, formatWeeks, teamPhrase } from '../present/format';
import { toComparison } from '../present/comparison';
import { parseDate, parseIntent, type Intent } from '../present/intent';
import { defaultTeam, estimateFor, makeVersion, panelInBrowser, scopeInBrowser, scopeOf, versionEstimate } from './engine';
import { syncRealProjects } from './realProjects';

const STORE_KEY = 'scopewise.conversations.v1';
const STEP_MS = 600;

let counter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const nowIso = () => new Date().toISOString();

/**
 * In-place update (6.6): the latest `estimate` message takes the new version and change note; what it showed before
 * goes onto `edits[]` so every version stays in the history. Appends only if there is no estimate message yet.
 */
export function replaceLatestEstimate(messages: Message[], estimateId: string, changeNote: string | undefined, now: string): Message[] {
  let idx = -1;
  for (let i = messages.length - 1; i >= 0 && idx < 0; i--) if (messages[i]?.kind === 'estimate') idx = i;
  if (idx < 0) return [...messages, { id: uid('m'), createdAt: now, kind: 'estimate', estimateId, changeNote }];
  return messages.map((m, i) => {
    if (i !== idx || m.kind !== 'estimate') return m;
    return { ...m, estimateId, changeNote, createdAt: now, edits: [...(m.edits ?? []), { estimateId: m.estimateId, changeNote: m.changeNote, createdAt: m.createdAt }] };
  });
}

// ---------------------------------------------------------------------------------------------
// Building blocks

export function fileChips(brief: BriefPack): { name: string; label: string }[] {
  return brief.sources.map((s) => {
    const key = s.kind === 'jira' ? s.text.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1] : undefined;
    return { name: s.name, label: key ? `${SOURCE_LABELS.jira} ${key}` : SOURCE_LABELS[s.kind] };
  });
}

function preview(brief: BriefPack): string {
  const text = brief.sources.find((s) => s.kind === 'email')?.text ?? brief.sources[0]?.text ?? '';
  const body = text
    .split('\n')
    .filter((l) => !/^(from|to|subject|cc|date):/i.test(l.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return body.length > 200 ? `${body.slice(0, 200).replace(/\s+\S*$/, '')}…` : body;
}

function steps(n: { docs: number; stages: number; similar: number }, doneUpTo: number, active: number): ProgressStep[] {
  const labels = [
    doneUpTo > 0 ? copy.stepRead(n.docs) : copy.stepReading(n.docs),
    doneUpTo > 1 ? copy.stepSplit(n.stages) : copy.stepSplitting,
    doneUpTo > 2 ? copy.stepCompared(n.similar) : copy.stepCompare(n.similar),
    copy.stepTimeline,
  ];
  return labels.map((label, i) => ({ label, state: i < doneUpTo ? 'done' : i === active ? 'active' : 'todo' }));
}

function similarCount(scope: ScopeResult | undefined): number {
  if (!scope) return 0;
  return seed.projects.filter((p) => p.status === 'closed' && p.projectType === scope.projectType).length;
}

function sampleConversation(i: number, opts: { ready: boolean }): Conversation {
  const s = samples[i];
  if (!s) throw new Error('missing sample');
  const scope = s.cache.scope;
  const created = opts.ready ? new Date(Date.UTC(2026, 9, 14 + i, 9, 30)).toISOString() : nowIso();
  const team = defaultTeam(scope);
  const conv: Conversation = {
    id: opts.ready ? `sample-${s.meta.id}` : uid('c'),
    title: scope.title || s.meta.title,
    createdAt: created,
    updatedAt: created,
    status: opts.ready ? 'ready' : 'working',
    brief: s.brief,
    sampleId: s.meta.id,
    squadId: s.meta.squad,
    scopeProvenance: s.cache.scopeProvenance,
    panelProvenance: s.cache.panelProvenance,
    messages: [],
    versions: {},
    currentEstimateId: '',
    team,
    startDate: s.meta.startDate,
    clientDeadline: s.meta.clientDeadline,
  };
  conv.messages.push({ id: uid('m'), createdAt: created, kind: 'user_brief', briefId: s.brief.id, preview: preview(s.brief), files: fileChips(s.brief) });
  const n = { docs: s.brief.sources.length, stages: scope.phases.length, similar: similarCount(scope) };
  if (opts.ready) {
    conv.messages.push({ id: uid('m'), createdAt: created, kind: 'progress', intro: copy.workingIntro, steps: steps(n, 4, -1) });
    const v = makeVersion(conv, specOf(conv, {}), uid('v'), created);
    if (v) {
      conv.versions[v.id] = v;
      conv.currentEstimateId = v.id;
      conv.messages.push({ id: uid('m'), createdAt: created, kind: 'estimate', estimateId: v.id });
    }
  } else {
    conv.messages.push({ id: uid('m'), createdAt: created, kind: 'progress', intro: copy.workingIntro, steps: steps(n, 0, 0) });
  }
  return conv;
}

function specOf(conv: Conversation, patch: Partial<EstimateSpec>): EstimateSpec {
  const cur = conv.versions[conv.currentEstimateId]?.spec;
  return {
    team: cur?.team ?? conv.team,
    answeredQuestionIds: cur?.answeredQuestionIds ?? [],
    droppedItemIds: cur?.droppedItemIds ?? [],
    startDate: cur?.startDate ?? conv.startDate,
    deadline: cur?.deadline ?? conv.clientDeadline,
    hoursPerDay: cur?.hoursPerDay,
    daysPerWeek: cur?.daysPerWeek,
    risks: cur?.risks,
    bufferPct: cur?.bufferPct,
    coveredRoles: cur?.coveredRoles,
    ...patch,
  };
}

function loadInitial(): Conversation[] {
  const raw = readStore<unknown>(STORE_KEY, null);
  if (raw) {
    const parsed = ConversationStore.safeParse(raw);
    if (parsed.success && parsed.data.conversations.length) {
      // A conversation interrupted mid-pipeline can't resume; mark it so the thread offers a retry.
      return parsed.data.conversations.map((c) =>
        c.status === 'working' ? { ...c, status: 'error', messages: [...c.messages, { id: uid('m'), createdAt: nowIso(), kind: 'error', text: 'This estimate was interrupted.', retry: true }] } : c,
      );
    }
  }
  return samples.map((_, i) => sampleConversation(i, { ready: true }));
}

// ---------------------------------------------------------------------------------------------
// Store

interface Store {
  mode: Mode;
  conversations: Conversation[];
  get: (id: string) => Conversation | undefined;
  startSample: (sampleId: string) => string;
  startBrief: (input: { text: string; files: File[]; jiraKeys: string[] }) => string;
  send: (id: string, text: string) => void;
  /** Change the estimate's inputs from the document itself. The card updates in place (no new message). */
  applySpec: (id: string, patch: Partial<EstimateSpec>, note?: string, inPlace?: boolean) => void;
  setTeam: (id: string, team: TeamShape, note?: string) => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
  decide: (id: string, messageId: string, use: boolean) => void;
  answer: (id: string, answers: { questionId: string; question: string; text: string }[]) => void;
  retry: (id: string) => void;
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
  busy: (id: string) => boolean;
}

const Ctx = createContext<Store | null>(null);

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>({ kind: 'checking' });
  const [conversations, setConversations] = useState<Conversation[]>(loadInitial);
  const [readOnly, setReadOnlyState] = useState<boolean>(() => readStore<string>('sw-view', 'manager') === 'overseer');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const ref = useRef(conversations);
  ref.current = conversations;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const files = useRef(new Map<string, File[]>());

  // Detect the API at start, and again when the tab regains focus (the API may have been started or
  // reconfigured in the meantime), at most once every few seconds.
  useEffect(() => {
    let alive = true;
    let last = 0;
    const check = () => {
      if (Date.now() - last < 5000) return;
      last = Date.now();
      detectMode().then((m) => {
        if (!alive) return;
        setMode(m);
        if (m.kind === 'live') void syncRealProjects();
      });
    };
    check();
    const onVisible = () => document.visibilityState === 'visible' && check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Save locally always; in live mode also to the API store (only conversations that changed).
  const saved = useRef(new Map<string, string>());
  useEffect(() => {
    const t = window.setTimeout(() => {
      writeStore(STORE_KEY, { version: 1, conversations });
      if (mode.kind !== 'live') return;
      for (const c of conversations) {
        if (c.status === 'working' || saved.current.get(c.id) === c.updatedAt) continue;
        saved.current.set(c.id, c.updatedAt);
        api.saveConversation(c).catch(() => saved.current.delete(c.id));
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [conversations, mode]);

  const setReadOnly = useCallback((v: boolean) => {
    setReadOnlyState(v);
    writeStore('sw-view', v ? 'overseer' : 'manager');
  }, []);

  const patch = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((cs) => cs.map((c) => (c.id === id ? { ...fn(c), updatedAt: nowIso() } : c)));
  }, []);
  const get = useCallback((id: string) => ref.current.find((c) => c.id === id), []);
  const push = useCallback((id: string, ...msgs: Message[]) => patch(id, (c) => ({ ...c, messages: [...c.messages, ...msgs] })), [patch]);
  const setBusy = (id: string, on: boolean) =>
    setBusyIds((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const setProgress = useCallback(
    (id: string, s: ProgressStep[]) =>
      patch(id, (c) => ({ ...c, messages: c.messages.map((m) => (m.kind === 'progress' ? { ...m, steps: s } : m)) })),
    [patch],
  );

  const finishWithEstimate = useCallback(
    (id: string) => {
      const c = ref.current.find((x) => x.id === id);
      if (!c) return;
      const v = makeVersion(c, specOf(c, {}), uid('v'), nowIso());
      if (!v) {
        patch(id, (x) => ({ ...x, status: 'error' }));
        push(id, { id: uid('m'), createdAt: nowIso(), kind: 'error', text: "I couldn't work out an estimate from this brief.", retry: true });
        return;
      }
      patch(id, (x) => ({ ...x, status: 'ready', versions: { ...x.versions, [v.id]: v }, currentEstimateId: v.id }));
      push(id, { id: uid('m'), createdAt: nowIso(), kind: 'estimate', estimateId: v.id });
    },
    [patch, push],
  );

  /** Demo: replay the cached pipeline so it feels live, ~600ms a step. */
  const replay = useCallback(
    (id: string) => {
      const c = ref.current.find((x) => x.id === id);
      const scope = c && scopeOf(c);
      if (!c || !scope) return;
      const n = { docs: c.brief.sources.length, stages: scope.phases.length, similar: similarCount(scope) };
      setBusy(id, true);
      [1, 2, 3].forEach((k) => window.setTimeout(() => setProgress(id, steps(n, k, k)), STEP_MS * k));
      // Warm the engine while the checklist plays, so the estimate appears the moment the last step ticks.
      window.setTimeout(() => {
        const cur = ref.current.find((x) => x.id === id);
        if (cur) estimateFor(cur, specOf(cur, {}));
      }, STEP_MS * 1.5);
      window.setTimeout(() => {
        setProgress(id, steps(n, 4, -1));
        finishWithEstimate(id);
        setBusy(id, false);
      }, STEP_MS * 4);
    },
    [finishWithEstimate, setProgress],
  );

  /** Live: real pipeline events drive the checklist. */
  const runLive = useCallback(
    async (id: string) => {
      const c = ref.current.find((x) => x.id === id);
      if (!c) return;
      setBusy(id, true);
      const docs = c.brief.sources.length || files.current.get(id)?.length || 1;
      try {
        setProgress(id, steps({ docs, stages: 0, similar: 0 }, 0, 0));
        const live = modeRef.current.kind === 'live';
        const upload = files.current.get(id) ?? [];
        if (!live) {
          // No API: pasted text is read in the browser. Jira and uploads have nowhere to go.
          if (c.brief.sources.some((s) => s.kind === 'jira')) throw new Error(copy.jiraNeedsApi);
          if (upload.length) throw new Error(copy.filesNeedApi);
        }
        // Jira links: pull each issue's summary and description into the brief.
        const issues: { key: string; summary: string }[] = [];
        const sources = await Promise.all(
          c.brief.sources.map(async (s) => {
            if (s.kind !== 'jira') return s;
            const key = s.text.match(/[A-Z][A-Z0-9]+-\d+/)?.[0];
            if (!key) return s;
            const issue = await api.jiraIssue(key);
            issues.push({ key: issue.key, summary: issue.summary });
            return { ...s, text: issue.text };
          }),
        );
        const withJira: BriefPack = { ...c.brief, sources };
        if (issues.length) {
          // Show what was read from Jira straight away: title, preview and file chips, before Claude is involved.
          patch(id, (x) => ({
            ...x,
            brief: withJira,
            title: x.title === 'New estimate' ? (issues[0]?.summary ?? x.title) : x.title,
            messages: x.messages.map((m) => (m.kind === 'user_brief' ? { ...m, preview: preview(withJira), files: fileChips(withJira) } : m)),
          }));
        }
        const read = issues.map((i) => copy.readTicket(i.key, i.summary)).join(' ');
        const text = sources.filter((s) => s.kind !== 'jira').map((s) => s.text).join('\n\n');
        const jiraFiles = sources.filter((s) => s.kind === 'jira').map((s) => new File([s.text], s.name, { type: 'text/markdown' }));
        // The API reads with Claude when it has a key, else with the engine's rules (and says so in `note`).
        const scoped = !live ? { ...scopeInBrowser(withJira), note: copy.demoOffline } : upload.length ? await api.scopeFromFiles(text, c.clientDeadline, [...upload, ...jiraFiles]) : await api.scope(withJira);
        const brief = scoped.brief ?? withJira;
        const scope = scoped.scope;
        const similar = similarCount(scope);
        const n = { docs: brief.sources.length, stages: scope.phases.length, similar };
        const deadline = c.clientDeadline ?? parseDate(brief.sources.map((s) => s.text).join(' '), c.startDate);
        patch(id, (x) => ({
          ...x,
          brief,
          // A ticket keeps its own name as the title; the scope's title is for pasted briefs.
          title: issues.length ? x.title : scope.title || x.title,
          scope,
          scopeProvenance: scoped.provenance,
          team: defaultTeam(scope),
          clientDeadline: deadline,
          messages: x.messages.map((m) => (m.kind === 'user_brief' ? { ...m, preview: preview(brief), files: fileChips(brief) } : m)),
        }));
        setProgress(id, steps(n, 2, 2));
        const panel = live ? await api.panel(brief, scope).catch(() => undefined) : panelInBrowser(scope);
        patch(id, (x) => ({ ...x, panel: panel?.panel, panelProvenance: panel?.provenance }));
        setProgress(id, steps(n, 3, 3));
        await new Promise((r) => window.setTimeout(r, 30));
        setProgress(id, steps(n, 4, -1));
        const how = [read, scoped.note ? copy.readByRules(scoped.note) : ''].filter(Boolean).join(' ');
        if (how) push(id, { id: uid('m'), createdAt: nowIso(), kind: 'answer', text: how });
        finishWithEstimate(id);
      } catch (err) {
        const cur = ref.current.find((x) => x.id === id);
        const jiraKeys = (cur?.brief.sources ?? []).filter((s) => s.kind === 'jira').map((s) => s.name.match(/[A-Z][A-Z0-9]+-\d+/)?.[0]).filter(Boolean);
        const read = cur && cur.title !== 'New estimate' && jiraKeys.length ? `${copy.readTicket(jiraKeys.join(', '), cur.title)} ` : '';
        patch(id, (x) => ({ ...x, status: 'error' }));
        push(id, { id: uid('m'), createdAt: nowIso(), kind: 'error', text: `${read}${copy.briefFailed(err instanceof Error ? err.message : 'unknown error')}`, retry: true });
      } finally {
        setBusy(id, false);
      }
    },
    [finishWithEstimate, patch, push, setProgress],
  );

  const startSample = useCallback(
    (sampleId: string) => {
      const i = samples.findIndex((s) => s.meta.id === sampleId);
      const conv = sampleConversation(i, { ready: false });
      setConversations((cs) => [conv, ...cs]);
      ref.current = [conv, ...ref.current];
      window.setTimeout(() => replay(conv.id), 30);
      return conv.id;
    },
    [replay],
  );

  const startBrief = useCallback(
    ({ text, files: fs, jiraKeys }: { text: string; files: File[]; jiraKeys: string[] }) => {
      const id = uid('c');
      const created = nowIso();
      const today = created.slice(0, 10);
      const sources: BriefPack['sources'] = text.trim() ? [{ kind: 'notes', name: 'pasted-brief.txt', text }] : [];
      for (const k of jiraKeys) sources.push({ kind: 'jira', name: `jira-${k}.md`, text: `Jira issue ${k}` });
      const brief: BriefPack = { id: `brief-${id}`, title: 'New brief', sources: sources.length ? sources : [{ kind: 'notes', name: 'uploaded-files', text: fs.map((f) => f.name).join(', ') }] };
      const deadline = parseDate(text, today);
      const conv: Conversation = {
        id,
        title: 'New estimate',
        createdAt: created,
        updatedAt: created,
        status: 'working',
        brief,
        squadId: seed.squads[0]?.id ?? 'alpha',
        messages: [
          {
            id: uid('m'),
            createdAt: created,
            kind: 'user_brief',
            briefId: brief.id,
            preview: text.length > 200 ? `${text.slice(0, 200)}…` : text,
            files: [...fs.map((f) => ({ name: f.name, label: f.name })), ...jiraKeys.map((k) => ({ name: k, label: `${SOURCE_LABELS.jira} ${k}` }))],
          },
          { id: uid('m'), createdAt: created, kind: 'progress', intro: copy.workingIntro, steps: steps({ docs: sources.length + fs.length, stages: 0, similar: 0 }, 0, 0) },
        ],
        versions: {},
        currentEstimateId: '',
        team: {},
        startDate: today,
        clientDeadline: deadline,
      };
      files.current.set(id, fs);
      setConversations((cs) => [conv, ...cs]);
      ref.current = [conv, ...ref.current];
      window.setTimeout(() => void runLive(id), 30);
      return id;
    },
    [runLive],
  );

  // --- follow-ups ----------------------------------------------------------------------------

  const reEstimate = useCallback(
    (id: string, spec: Partial<EstimateSpec>, because: string) => {
      const c = ref.current.find((x) => x.id === id);
      if (!c) return;
      const before = c.versions[c.currentEstimateId];
      const v = makeVersion(c, specOf(c, spec), uid('v'), nowIso());
      if (!v) return;
      const was = before ? formatWeeks(before.summary.weeksLow, before.summary.weeksHigh) : '';
      const now = formatWeeks(v.summary.weeksLow, v.summary.weeksHigh);
      patch(id, (x) => ({ ...x, team: v.spec.team, versions: { ...x.versions, [v.id]: v }, currentEstimateId: v.id }));
      push(id, { id: uid('m'), createdAt: nowIso(), kind: 'estimate', estimateId: v.id, changeNote: copy.updated(now, was, because) });
    },
    [patch, push],
  );

  const applySpec = useCallback(
    (id: string, specPatch: Partial<EstimateSpec>, note?: string, inPlace = true) => {
      const c = ref.current.find((x) => x.id === id);
      if (!c) return;
      const now = nowIso();
      const v = makeVersion(c, specOf(c, specPatch), uid('v'), now);
      if (!v) return;
      patch(id, (x) => ({
        ...x,
        team: v.spec.team,
        versions: { ...x.versions, [v.id]: v },
        currentEstimateId: v.id,
        messages: inPlace ? replaceLatestEstimate(x.messages, v.id, note, now) : [...x.messages, { id: uid('m'), createdAt: now, kind: 'estimate', estimateId: v.id, changeNote: note }],
      }));
    },
    [patch],
  );

  const setTeam = useCallback((id: string, team: TeamShape, note?: string) => applySpec(id, { team }, note, true), [applySpec]);

  const rename = useCallback((id: string, title: string) => patch(id, (c) => ({ ...c, title: title.trim() || c.title })), [patch]);

  const remove = useCallback((id: string) => {
    setConversations((cs) => cs.filter((c) => c.id !== id));
    ref.current = ref.current.filter((c) => c.id !== id);
  }, []);

  const propose = useCallback(
    (id: string, spec: Partial<EstimateSpec>, label: string, why?: string) => {
      const c = ref.current.find((x) => x.id === id);
      if (!c) return;
      const v = makeVersion(c, specOf(c, spec), uid('v'), nowIso());
      const a = versionEstimate(c, c.currentEstimateId, true);
      if (!v || !a) return;
      const b = estimateFor(c, v.spec, { quick: true });
      if (!b) return;
      const cmp = toComparison(a, b, why);
      patch(id, (x) => ({ ...x, versions: { ...x.versions, [v.id]: v } }));
      push(id, { id: uid('m'), createdAt: nowIso(), kind: 'comparison', baseEstimateId: c.currentEstimateId, proposedEstimateId: v.id, proposedLabel: label, summary: cmp.summary });
    },
    [patch, push],
  );

  const answerText = useCallback((id: string, text: string) => push(id, { id: uid('m'), createdAt: nowIso(), kind: 'answer', text }), [push]);

  const handleIntent = useCallback(
    async (id: string, text: string, intent: Intent) => {
      const c = ref.current.find((x) => x.id === id);
      const scope = c && scopeOf(c);
      if (!c || !scope) return;
      const cur = c.versions[c.currentEstimateId];
      const est = versionEstimate(c, c.currentEstimateId);
      switch (intent.kind) {
        case 'team_what_if':
          propose(id, { team: intent.team }, intent.label, intent.why);
          return;
        case 'drop_what_if':
          propose(id, { droppedItemIds: [...new Set([...(cur?.spec.droppedItemIds ?? []), ...intent.itemIds])] }, intent.label, 'because there is less work to do');
          return;
        case 'deadline_check': {
          if (!est || !cur) return;
          const spec = { ...cur.spec, deadline: intent.date };
          const now = estimateFor(c, spec, { quick: true });
          const p = now?.onTimeProbability ?? 0;
          let reply = `${chanceWords(p)} of finishing by ${formatDate(intent.date)} with ${teamPhrase(cur.spec.team)}.`;
          if (p < 0.8) {
            // Try adding people one role at a time, then two, and keep the smallest change that makes it safe.
            const roles = [...new Set(scope.items.map((i) => i.role))];
            const options: { team: typeof cur.spec.team; p: number; label: string; extra: number }[] = [];
            for (const r of roles)
              for (const extra of [1, 2, 3]) {
                const team = { ...cur.spec.team, [r]: (cur.spec.team[r] ?? 0) + extra };
                const e = estimateFor(c, { ...spec, team }, { quick: true });
                if (e) options.push({ team, p: e.onTimeProbability ?? 0, label: `${extra === 1 ? 'one' : extra} more ${roleWord(r, extra)}`, extra });
              }
            const safe = options.filter((o) => o.p >= 0.8).sort((a, b) => a.extra - b.extra || b.p - a.p)[0];
            if (safe) reply += ` To be safe by ${formatDate(intent.date)} you'd need ${safe.label} (${teamPhrase(safe.team)}).`;
            else {
              const best = options.sort((a, b) => b.p - a.p)[0];
              reply += ` Adding people alone doesn't make it safe: the best I found is ${best?.label ?? 'no change'}, which gives ${chanceWords(best?.p ?? p).toLowerCase()}. You could drop part of the work, or promise ${formatDate(est.commitDate)} instead.`;
            }
          } else reply += ' That date is safe to promise.';
          answerText(id, reply);
          return;
        }
        case 'explain': {
          if (!est) return;
          const ph = est.perPhase.find((p) => p.phaseId === intent.phaseId);
          if (!ph) return;
          const items = est.items.filter((i) => i.phaseId === ph.phaseId).sort((a, b) => b.p50 - a.p50);
          const titles = new Map(scope.items.map((i) => [i.id, i.title]));
          const hours = Math.round(items.reduce((s, i) => s + i.p50, 0));
          const people = cur?.spec.team[ph.role] ?? 1;
          const long = items[0] && items[0].biasFactor >= 1.2;
          const top = items
            .slice(0, 2)
            .map((i) => `${titles.get(i.itemId)?.toLowerCase()} (about ${Math.round(i.p50)}–${Math.round(i.p80)} hours)`)
            .join(' and ');
          answerText(
            id,
            `${ph.name} takes about ${formatDuration(ph.endDayP50 - ph.startDay)}: it's ${items.length} piece${items.length === 1 ? '' : 's'} of work, about ${hours} hours, shared by ${people} ${people === 1 ? 'person' : 'people'}. The biggest are ${top}.` +
              (long ? ' This kind of work has run long on past projects, so I allowed extra time.' : ''),
          );
          return;
        }
        case 'new_info': {
          const note = { kind: 'notes' as const, name: `client-update-${c.brief.sources.length + 1}.txt`, text: intent.note };
          patch(id, (x) => ({ ...x, brief: { ...x.brief, sources: [...x.brief.sources, note] } }));
          if (intent.questionIds.length) {
            const qs = scope.missingInfo.filter((q) => intent.questionIds.includes(q.id));
            reEstimate(id, { answeredQuestionIds: [...new Set([...(cur?.spec.answeredQuestionIds ?? []), ...intent.questionIds])] }, `the client answered “${qs[0]?.question.replace(/\?$/, '')}”`);
          } else answerText(id, "Thanks, I've added that to the brief. It doesn't change any of the open questions, so the estimate stays the same.");
          return;
        }
        case 'other': {
          if (modeRef.current.kind === 'live' && modeRef.current.health.features.claude && cur) {
            setBusy(id, true);
            try {
              const thread = c.messages.filter((m) => m.kind === 'user_text' || m.kind === 'answer').slice(-8);
              const r = await api.ask(
                [...thread.map((m) => ({ role: m.kind === 'user_text' ? ('user' as const) : ('assistant' as const), content: m.kind === 'user_text' || m.kind === 'answer' ? m.text : '' })), { role: 'user', content: text }],
                { scope, panel: c.panel, teamShape: cur.spec.team, squadId: c.squadId, startDate: cur.spec.startDate, deadline: cur.spec.deadline, answeredQuestionIds: cur.spec.answeredQuestionIds, droppedItemIds: cur.spec.droppedItemIds },
              );
              push(id, { id: uid('m'), createdAt: nowIso(), kind: 'answer', text: r.answer, sources: r.toolCalls.map((t) => t.summary) });
            } catch (err) {
              push(id, { id: uid('m'), createdAt: nowIso(), kind: 'error', text: `I couldn't reach the API: ${err instanceof Error ? err.message : 'unknown error'}`, retry: true });
            } finally {
              setBusy(id, false);
            }
          } else answerText(id, copy.demoOther);
          return;
        }
      }
    },
    [answerText, patch, propose, push, reEstimate],
  );

  const send = useCallback(
    (id: string, text: string) => {
      const c = ref.current.find((x) => x.id === id);
      const scope = c && scopeOf(c);
      const cur = c?.versions[c.currentEstimateId];
      if (!c || !scope || !cur || !text.trim()) return;
      push(id, { id: uid('m'), createdAt: nowIso(), kind: 'user_text', text: text.trim() });
      const intent = parseIntent(text, { scope, team: cur.spec.team, refDate: cur.spec.startDate, answeredQuestionIds: cur.spec.answeredQuestionIds });
      window.setTimeout(() => void handleIntent(id, text, intent), 350);
    },
    [handleIntent, push],
  );

  const decide = useCallback(
    (id: string, messageId: string, use: boolean) => {
      const c = ref.current.find((x) => x.id === id);
      const msg = c?.messages.find((m) => m.id === messageId);
      if (!c || !msg || msg.kind !== 'comparison' || msg.applied !== undefined) return;
      patch(id, (x) => ({ ...x, messages: x.messages.map((m) => (m.id === messageId && m.kind === 'comparison' ? { ...m, applied: use } : m)) }));
      if (!use) return;
      const before = c.versions[c.currentEstimateId];
      const next = c.versions[msg.proposedEstimateId];
      if (!next) return;
      patch(id, (x) => ({ ...x, team: next.spec.team, currentEstimateId: next.id }));
      push(id, {
        id: uid('m'),
        createdAt: nowIso(),
        kind: 'estimate',
        estimateId: next.id,
        changeNote: copy.updated(formatWeeks(next.summary.weeksLow, next.summary.weeksHigh), before ? formatWeeks(before.summary.weeksLow, before.summary.weeksHigh) : '', msg.proposedLabel.replace(/^With /, 'you planned for ').replace(/^Without /, 'you dropped ')),
      });
    },
    [patch, push],
  );

  const answer = useCallback(
    (id: string, answers: { questionId: string; question: string; text: string }[]) => {
      const c = ref.current.find((x) => x.id === id);
      const cur = c?.versions[c.currentEstimateId];
      const given = answers.filter((a) => a.text.trim());
      if (!c || !cur || !given.length) return;
      const text = given.map((a) => `${a.question}\n${a.text.trim()}`).join('\n\n');
      push(id, { id: uid('m'), createdAt: nowIso(), kind: 'user_text', text });
      patch(id, (x) => ({ ...x, brief: { ...x.brief, sources: [...x.brief.sources, { kind: 'notes', name: `client-answers-${x.brief.sources.length + 1}.txt`, text }] } }));
      const engineQs = given.filter((a) => scopeOf(c)?.missingInfo.some((q) => q.id === a.questionId)).map((a) => a.questionId);
      window.setTimeout(
        () => reEstimate(id, { answeredQuestionIds: [...new Set([...cur.spec.answeredQuestionIds, ...engineQs])] }, `you answered ${given.length} question${given.length === 1 ? '' : 's'}`),
        300,
      );
    },
    [patch, push, reEstimate],
  );

  const retry = useCallback(
    (id: string) => {
      const c = ref.current.find((x) => x.id === id);
      if (!c) return;
      patch(id, (x) => ({ ...x, status: x.currentEstimateId ? 'ready' : 'working', messages: x.messages.filter((m) => m.kind !== 'error') }));
      if (!c.currentEstimateId) {
        if (c.sampleId) replay(id);
        else void runLive(id);
      }
    },
    [patch, replay, runLive],
  );

  const busy = useCallback((id: string) => busyIds.has(id), [busyIds]);

  const value = useMemo<Store>(
    () => ({ mode, conversations, get, startSample, startBrief, send, applySpec, setTeam, rename, remove, decide, answer, retry, readOnly, setReadOnly, busy }),
    [mode, conversations, get, startSample, startBrief, send, applySpec, setTeam, rename, remove, decide, answer, retry, readOnly, setReadOnly, busy],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConversations(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useConversations outside ConversationsProvider');
  return s;
}

/** Sidebar order: newest first. */
export function sortedConversations(cs: Conversation[]): Conversation[] {
  return [...cs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

