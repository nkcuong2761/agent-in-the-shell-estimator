import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AskScriptEntry,
  BriefPack,
  Estimate,
  HistoryItem,
  HistoryProject,
  Lesson,
  PanelResult,
  Provenance,
  ScopeResult,
  Squad,
  SquadStats,
  TeamShape,
  Worklog,
} from '@scopewise/shared';
import { DEFAULT_SQUAD_STATS, prepareEstimate, runEstimate, squadStatsFromWorklogs, type PreparedEstimate } from '@scopewise/engine';
import { detectMode, type Mode } from './api';
import { samples, seed } from './data';
import { readStore, writeStore } from './storage';

export interface Workspace {
  id: string;
  title: string;
  client: string;
  brief: BriefPack;
  scope: ScopeResult;
  scopeProvenance: Provenance;
  panel?: PanelResult;
  panelProvenance?: Provenance;
  ask: AskScriptEntry[];
  squadId: string;
  teamShape: TeamShape;
  startDate: string;
  deadline?: string;
  answered: string[];
  dropped: string[];
  origin: 'sample' | 'upload';
}

export interface History {
  projects: HistoryProject[];
  items: HistoryItem[];
  squads: Squad[];
  worklogs: Worklog[];
  source: 'seed' | 'jira';
  syncedAt?: string;
}

export type ViewMode = 'manager' | 'overseer';

function teamOf(squad: Squad | undefined): TeamShape {
  const t: TeamShape = {};
  for (const m of squad?.members ?? []) t[m.role] = m.count;
  return t;
}

function sampleWorkspace(i: number): Workspace {
  const s = samples[i];
  if (!s) throw new Error('missing sample');
  const squad = seed.squads.find((q) => q.id === s.meta.squad);
  return {
    id: s.meta.id,
    title: s.meta.title,
    client: s.meta.client,
    brief: s.brief,
    scope: s.cache.scope,
    scopeProvenance: s.cache.scopeProvenance,
    panel: s.cache.panel,
    panelProvenance: s.cache.panelProvenance,
    ask: s.cache.ask,
    squadId: s.meta.squad,
    teamShape: teamOf(squad),
    startDate: s.meta.startDate,
    deadline: s.meta.clientDeadline,
    answered: [],
    dropped: [],
    origin: 'sample',
  };
}

interface Store {
  mode: Mode;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  workspaces: Record<string, Workspace>;
  order: string[];
  activeId: string;
  setActive: (id: string) => void;
  update: (id: string, patch: Partial<Workspace>) => void;
  reset: (id: string) => void;
  addWorkspace: (w: Workspace) => void;
  history: History;
  setHistory: (h: History) => void;
  squadStats: (squadId: string) => SquadStats;
  lessons: Lesson[];
  addLesson: (l: Lesson) => void;
  askOpen: boolean;
  setAskOpen: (open: boolean) => void;
}

const Ctx = createContext<Store | null>(null);

const initialWorkspaces = (): Record<string, Workspace> => Object.fromEntries(samples.map((_, i) => [samples[i]?.meta.id ?? '', sampleWorkspace(i)]));

export function StoreProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>({ kind: 'checking' });
  const [viewMode, setViewModeState] = useState<ViewMode>(() => readStore<ViewMode>('sw-view', 'manager'));
  const [workspaces, setWorkspaces] = useState<Record<string, Workspace>>(initialWorkspaces);
  const [order, setOrder] = useState<string[]>(() => samples.map((s) => s.meta.id));
  const [activeId, setActive] = useState<string>(samples[0]?.meta.id ?? '');
  const [history, setHistory] = useState<History>({ ...seed, source: 'seed' });
  const [lessons, setLessons] = useState<Lesson[]>(() => readStore<Lesson[]>('sw-lessons', []));
  const [askOpen, setAskOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    detectMode().then((m) => alive && setMode(m));
    return () => {
      alive = false;
    };
  }, []);

  const setViewMode = useCallback((v: ViewMode) => {
    setViewModeState(v);
    writeStore('sw-view', v);
  }, []);

  const update = useCallback((id: string, patch: Partial<Workspace>) => {
    setWorkspaces((ws) => (ws[id] ? { ...ws, [id]: { ...ws[id], ...patch } } : ws));
  }, []);

  const reset = useCallback((id: string) => {
    const i = samples.findIndex((s) => s.meta.id === id);
    if (i >= 0) setWorkspaces((ws) => ({ ...ws, [id]: sampleWorkspace(i) }));
  }, []);

  const addWorkspace = useCallback((w: Workspace) => {
    setWorkspaces((ws) => ({ ...ws, [w.id]: w }));
    setOrder((o) => (o.includes(w.id) ? o : [...o, w.id]));
    setActive(w.id);
  }, []);

  const addLesson = useCallback((l: Lesson) => {
    setLessons((ls) => {
      const next = [{ ...l, createdAt: l.createdAt ?? new Date().toISOString().slice(0, 10), source: l.source ?? 'user' }, ...ls];
      writeStore('sw-lessons', next);
      return next;
    });
  }, []);

  // Capacity per squad: seed stats, or derived from synced Jira worklogs. Memoised so references are stable.
  const statsBySquad = useMemo(() => {
    const m = new Map<string, SquadStats>();
    for (const squad of history.squads) {
      m.set(
        squad.id,
        history.source === 'jira' && history.worklogs.length
          ? squadStatsFromWorklogs(history.worklogs, squad.id, squad.stats.coordinationOverheadPerExtra).value
          : squad.stats,
      );
    }
    return m;
  }, [history]);
  const squadStats = useCallback((squadId: string): SquadStats => statsBySquad.get(squadId) ?? DEFAULT_SQUAD_STATS, [statsBySquad]);

  const value = useMemo<Store>(
    () => ({
      mode,
      viewMode,
      setViewMode,
      workspaces,
      order,
      activeId,
      setActive,
      update,
      reset,
      addWorkspace,
      history,
      setHistory,
      squadStats,
      lessons,
      addLesson,
      askOpen,
      setAskOpen,
    }),
    [mode, viewMode, setViewMode, workspaces, order, activeId, update, reset, addWorkspace, history, squadStats, lessons, addLesson, askOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

export function useWorkspace(id?: string): Workspace | undefined {
  const { workspaces, activeId } = useStore();
  return workspaces[id ?? activeId];
}

/** History-dependent preparation, cached per workspace inputs that don't change with team or answers. */
export function usePrepared(ws: Workspace | undefined): PreparedEstimate | undefined {
  const { history, squadStats } = useStore();
  const squad = history.squads.find((s) => s.id === ws?.squadId);
  const stats = ws ? squadStats(ws.squadId) : undefined;
  return useMemo(() => {
    if (!ws || !stats) return undefined;
    return prepareEstimate({
      scope: ws.scope,
      panel: ws.panel,
      history: { projects: history.projects, items: history.items, squads: history.squads },
      squad: stats,
      plannedLeave: squad?.plannedLeave ?? [],
      teamShape: ws.teamShape,
      startDate: ws.startDate,
      deadline: ws.deadline,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.scope, ws?.panel, ws?.startDate, ws?.deadline, ws?.squadId, history, stats, squad]);
}

/** Full estimate (5,000 runs + value of information), recomputed shortly after inputs settle. */
function useEstimate(ws: Workspace | undefined): { estimate: Estimate | undefined; prep: PreparedEstimate | undefined; pending: boolean } {
  const prep = usePrepared(ws);
  const [estimate, setEstimate] = useState<Estimate | undefined>(undefined);
  const [pending, setPending] = useState(true);
  const team = ws?.teamShape;
  const answered = ws?.answered;
  const dropped = ws?.dropped;
  const deadline = ws?.deadline;
  useEffect(() => {
    if (!prep) return;
    setPending(true);
    const t = window.setTimeout(() => {
      setEstimate(runEstimate(prep, { teamShape: team, answeredQuestionIds: answered, droppedItemIds: dropped, deadline }));
      setPending(false);
    }, 60);
    return () => window.clearTimeout(t);
  }, [prep, team, answered, dropped, deadline]);
  return { estimate, prep, pending };
}

interface ActiveEstimate {
  ws: Workspace | undefined;
  estimate: Estimate | undefined;
  prep: PreparedEstimate | undefined;
  pending: boolean;
}

const EstimateCtx = createContext<ActiveEstimate>({ ws: undefined, estimate: undefined, prep: undefined, pending: true });

/** Computes the estimate once for the active workspace; pages and the Ask panel read it from here. */
export function ActiveEstimateProvider({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const { estimate, prep, pending } = useEstimate(ws);
  const value = useMemo(() => ({ ws, estimate, prep, pending }), [ws, estimate, prep, pending]);
  return <EstimateCtx.Provider value={value}>{children}</EstimateCtx.Provider>;
}

export function useActiveEstimate(): ActiveEstimate {
  return useContext(EstimateCtx);
}
