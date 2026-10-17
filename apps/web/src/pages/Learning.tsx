import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DemoPostmortems, Lesson, PostmortemResult, Role, TimesheetRow } from '@scopewise/shared';
import { LessonCause } from '@scopewise/shared';
import { backtest, squadStatsFromWorklogs, worklogsFromTimesheet, type BacktestResult } from '@scopewise/engine';
import type { Explained } from '@scopewise/engine';
import { Box } from '../components/Ascii';
import { ExplainButton } from '../components/Explain';
import { DisabledNote, ProvenanceNote, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { loadPostmortems, PROJECT_TYPE_LABELS } from '../lib/data';
import { hours, longDate, pct } from '../lib/format';
import { useStore } from '../lib/store';

const CAUSE_LABELS: Record<LessonCause, string> = {
  'scope-added': 'Scope added',
  underestimated: 'Underestimated',
  blocked: 'Blocked',
  availability: 'Availability',
  'data-error': 'Data error',
};

function useBacktest() {
  const { history } = useStore();
  const [result, setResult] = useState<Explained<BacktestResult> | null>(null);
  useEffect(() => {
    setResult(null);
    // Let the page paint first; 40 walk-forward re-estimates take a few hundred ms.
    const t = window.setTimeout(() => setResult(backtest(history, { runs: 300 })), 30);
    return () => window.clearTimeout(t);
  }, [history]);
  return result;
}

function AccuracyChart({ bt }: { bt: BacktestResult }) {
  const data = bt.points.map((p) => ({ ...p, raw: Math.round(p.rollingRawMMRE * 1000) / 10, cal: Math.round(p.rollingCalibratedMMRE * 1000) / 10 }));
  const last = data[data.length - 1];
  return (
    <div className="flex flex-col gap-3">
      <ul className="list-none m-0 p-0 flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Legend">
        <li className="inline-flex items-center gap-2">
          <span aria-hidden="true" style={{ width: 22, borderTop: '2px solid var(--series-cal)' }} /> Calibrated engine
        </li>
        <li className="inline-flex items-center gap-2">
          <span aria-hidden="true" style={{ width: 22, borderTop: '2px dashed var(--series-raw)' }} /> Raw panel estimate
        </li>
      </ul>
      <div style={{ height: 280 }} role="img" aria-label={`Rolling mean relative error over ${data.length} closed projects. Last value: calibrated ${last?.cal}%, raw ${last?.raw}%.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 84, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--rule-soft)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="order" tickLine={false} axisLine={{ stroke: 'var(--rule)' }} label={{ value: 'closed projects, in date order', position: 'insideBottom', offset: -4, fill: 'var(--graphite)', fontSize: 11 }} height={36} />
            <YAxis tickLine={false} axisLine={false} unit="%" width={44} domain={[0, 'auto']} />
            <Tooltip
              cursor={{ stroke: 'var(--ink)', strokeDasharray: '2 3' }}
              contentStyle={{ background: 'var(--paper)', border: '1px solid var(--ink)', color: 'var(--ink)' }}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                return p ? `#${p.order} ${p.name}` : '';
              }}
              formatter={(v, name) => [`${v}%`, name === 'cal' ? 'Calibrated' : 'Raw panel']}
            />
            <Line type="monotone" dataKey="raw" stroke="var(--series-raw)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, stroke: 'var(--paper)', strokeWidth: 2 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="cal" stroke="var(--series-cal)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--paper)', strokeWidth: 2 }} isAnimationActive={false}
              label={(props: { index?: number; x?: number | string; y?: number | string }) =>
                props.index === data.length - 1 ? (
                  <text key="lab-cal" x={Number(props.x) + 8} y={Number(props.y)} dy={4} fontSize={11} fontFamily="var(--font-mono)" fill="var(--ink)">
                    calibrated {last?.cal}%
                  </text>
                ) : <g key={`n${props.index}`} />
              }
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-sm muted m-0">
        Rolling mean relative error over the last 8 projects. Each project is re-estimated using only projects that had closed before it started.
      </p>
    </div>
  );
}

function Metric({ label, value, help, raw }: { label: string; value: string; help: string; raw?: string }) {
  return (
    <div>
      <p className="text-sm muted m-0 mb-1.5">{label}</p>
      <p className="stat-value m-0 text-[2rem]">{value}</p>
      <p className="stat-help m-0">
        {help}
        {raw ? <span className="block">Raw panel: {raw}</span> : null}
      </p>
    </div>
  );
}

function TimesheetImport() {
  const { history, setHistory, mode } = useStore();
  const [text, setText] = useState('date,squad,role,hours\n2026-09-07,alpha,engineer,96\n2026-09-08,alpha,engineer,14\n2026-09-07,alpha,qa,30');
  const [msg, setMsg] = useState<string | null>(null);
  const [derived, setDerived] = useState<{ squad: string; focus: number; absence: number; rows: number }[]>([]);

  const parse = () => {
    const rows: TimesheetRow[] = [];
    const errors: string[] = [];
    text
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .forEach((line, i) => {
        const [date, squad, role, h] = line.split(',').map((x) => x.trim());
        const hoursN = Number(h);
        if (!date || !squad || !role || !Number.isFinite(hoursN)) errors.push(`line ${i + 2}`);
        else rows.push({ date, squad, role: role as Role, hours: hoursN });
      });
    if (errors.length) {
      setMsg(`Skipped ${errors.length} unreadable row${errors.length === 1 ? '' : 's'} (${errors.slice(0, 3).join(', ')}). Expected: date, squad, role, hours.`);
    } else setMsg(null);
    const headcount = (squad: string, role: Role) => Math.max(1, history.squads.find((s) => s.id === squad)?.members.find((m) => m.role === role)?.count ?? 1);
    const logs = worklogsFromTimesheet(rows, headcount);
    const squads = [...new Set(logs.map((l) => l.squad))];
    setDerived(
      squads.map((s) => {
        const st = squadStatsFromWorklogs(logs, s).value;
        return { squad: s, focus: st.focusFactor, absence: st.absenceRate, rows: logs.filter((l) => l.squad === s).length };
      }),
    );
  };

  const apply = () => {
    setHistory({
      ...history,
      squads: history.squads.map((s) => {
        const d = derived.find((x) => x.squad === s.id);
        return d ? { ...s, stats: { ...s.stats, focusFactor: d.focus, absenceRate: d.absence } } : s;
      }),
    });
    setMsg('Applied. Estimates for these squads now use the imported capacity.');
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm muted">Fallback when Jira worklogs are missing. Paste a CSV with one row per day, squad and role. It’s parsed in your browser.</p>
      <label htmlFor="csv" className="sr-only">
        Timesheet CSV
      </label>
      <textarea id="csv" className="input mono text-[13px]" rows={5} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
      <div className="flex flex-wrap gap-3 items-center">
        <button className="btn" onClick={parse}>
          Read timesheet
        </button>
        {derived.length ? (
          <button className="btn btn-primary" onClick={apply}>
            Use this capacity
          </button>
        ) : null}
        {mode.kind === 'demo' ? <span className="text-xs muted">Works in demo mode.</span> : null}
      </div>
      {msg ? (
        <p className="m-0 text-sm" role="status">
          {msg}
        </p>
      ) : null}
      {derived.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Squad</th>
              <th className="r">Role-weeks</th>
              <th className="r">Focus</th>
              <th className="r">Absence</th>
            </tr>
          </thead>
          <tbody>
            {derived.map((d) => (
              <tr key={d.squad}>
                <td>{d.squad}</td>
                <td className="r mono">{d.rows}</td>
                <td className="r mono">{pct(d.focus)}</td>
                <td className="r mono">{pct(d.absence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function JiraSync() {
  const { mode, history, setHistory } = useStore();
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const live = mode.kind === 'live' && mode.health.features.jira;
  const sync = async () => {
    setState({ busy: true });
    try {
      const data = await api.jiraHistory(true);
      setHistory({ projects: data.projects, items: data.items, worklogs: data.worklogs, squads: history.squads, source: 'jira', syncedAt: data.syncedAt ?? new Date().toISOString() });
      setState({ busy: false });
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : 'Sync failed.' });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0">
        History source: <span className="font-semibold">{history.source === 'jira' ? `Jira, synced ${longDate(history.syncedAt)}` : 'bundled seed data (fictional)'}</span>.{' '}
        {history.projects.filter((p) => p.status === 'closed').length} closed projects, {history.items.length} items.
      </p>
      <div className="flex flex-wrap gap-3 items-center">
        <button className="btn" disabled={!live || state.busy} onClick={sync}>
          Sync history from Jira
        </button>
        {state.busy ? <Spinner label="Reading epics, issues and worklogs" /> : null}
      </div>
      {!live ? <DisabledNote>{mode.kind === 'live' ? 'The API is up, but no Jira site is configured.' : 'Live Jira sync needs the Scopewise API. In demo mode the same history is bundled with the site.'}</DisabledNote> : null}
      {state.error ? (
        <p role="alert" className="m-0 text-sm" style={{ color: 'var(--pink-ink)' }}>
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

export function Learning() {
  const { history, lessons: userLessons, addLesson, mode } = useStore();
  const bt = useBacktest();
  const [pm, setPm] = useState<DemoPostmortems | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [livePm, setLivePm] = useState<Record<string, PostmortemResult>>({});
  const [pmBusy, setPmBusy] = useState(false);

  useEffect(() => {
    loadPostmortems().then((d) => setPm(d as DemoPostmortems));
  }, []);

  const closed = useMemo(() => history.projects.filter((p) => p.status === 'closed').sort((a, b) => a.startDate.localeCompare(b.startDate)), [history]);
  const btById = useMemo(() => new Map(bt?.value.points.map((p) => [p.projectId, p]) ?? []), [bt]);
  const seedLessons: Lesson[] = useMemo(
    () => (pm?.results ?? []).flatMap((r) => r.lessons.slice(0, 1).map((l) => ({ projectId: r.projectId, cause: l.cause, note: l.note, appliesTo: { category: l.appliesTo.category, projectType: closed.find((p) => p.id === r.projectId)?.projectType }, source: 'seed' as const }))),
    [pm, closed],
  );
  const allLessons = [...userLessons, ...seedLessons];
  const causeCounts = useMemo(() => {
    const m = new Map<LessonCause, number>();
    for (const r of pm?.results ?? []) for (const f of r.findings) if (f.scope === 'item') m.set(f.cause, (m.get(f.cause) ?? 0) + 1);
    return m;
  }, [pm]);

  const current = selected ? (livePm[selected] ?? pm?.results.find((r) => r.projectId === selected)) : undefined;
  const currentProject = closed.find((p) => p.id === selected);
  const claudeLive = mode.kind === 'live' && mode.health.features.claude;

  const rerun = async (id: string) => {
    setPmBusy(true);
    try {
      const r = await api.postmortem(id);
      setLivePm((m) => ({ ...m, [id]: r.result }));
    } finally {
      setPmBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="h-page m-0">Learning</h1>
        <p className="lede m-0">Closed projects feed the next estimate. Each miss gets a cause and a one-line lesson, and the calibration below shows whether the engine is actually getting better.</p>
      </header>

      <Box title="Accuracy over time" labelledBy="acc-title">
        {bt ? (
          <div className="flex flex-col gap-8">
            <div className="grid gap-8 sm:grid-cols-3">
              <Metric label="Mean relative error" value={pct(bt.value.calibrated.mmre)} raw={pct(bt.value.raw.mmre)} help="MMRE: average gap between estimate and actual." />
              <Metric label="Within 25% of actual" value={pct(bt.value.calibrated.pred25)} raw={pct(bt.value.raw.pred25)} help="PRED(25): share of projects estimated within 25%." />
              <Metric label="P80 hit rate" value={pct(bt.value.calibrated.p80HitRate)} help="Share of projects that finished at or under their P80. The target is about 80%." />
            </div>
            <div className="flex items-center gap-2 text-sm muted -mt-4">
              How the backtest works <ExplainButton title="Walk-forward backtest" explanation={bt.explanation} />
            </div>
            <AccuracyChart bt={bt.value} />
          </div>
        ) : (
          <Spinner label="Replaying 40 closed projects" />
        )}
      </Box>

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Box title="Closed projects" labelledBy="closed-title">
          <div className="overflow-x-auto max-h-[36rem] overflow-y-auto">
            <table className="table min-w-[38rem]">
              <thead className="sticky top-0" style={{ background: 'var(--paper)' }}>
                <tr>
                  <th>Project</th>
                  <th className="r">Estimate</th>
                  <th className="r">Actual</th>
                  <th className="r">Engine P80</th>
                  <th>
                    <span className="sr-only">Why we missed</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => {
                  const b = btById.get(p.id);
                  const ratio = p.actualH / p.estimateH;
                  return (
                    <tr key={p.id} aria-selected={selected === p.id} style={selected === p.id ? { background: 'var(--paper-2)' } : undefined}>
                      <td>
                        <span className="font-semibold">{p.name}</span>
                        <span className="block text-xs muted">
                          {PROJECT_TYPE_LABELS[p.projectType]}, {p.size}, squad {p.squad}, closed {longDate(p.endDate)}
                        </span>
                      </td>
                      <td className="r mono">{hours(p.estimateH)}</td>
                      <td className="r mono" style={{ color: ratio > 1.25 ? 'var(--pink-ink)' : undefined }}>
                        {hours(p.actualH)}
                        <span className="block text-xs muted">×{ratio.toFixed(2)}</span>
                      </td>
                      <td className="r mono">
                        {b ? hours(b.calibratedP80) : ''}
                        {b ? <span className="block text-xs muted">{b.withinP80 ? 'held' : 'missed'}</span> : null}
                      </td>
                      <td className="r">
                        <button className="btn btn-sm" onClick={() => setSelected(p.id)} aria-label={`Why ${p.name} missed`}>
                          Why
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs muted m-0 mt-3">Actual hours include the two suspected time-entry errors; the accuracy metrics leave them out.</p>
        </Box>

        <div className="flex flex-col gap-12">
          <Box title="Why we missed" labelledBy="why-title" well>
            {current && currentProject ? (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="m-0 font-semibold">{currentProject.name}</p>
                  <p className="m-0 text-sm mt-1">{current.summary}</p>
                </div>
                <ul className="list-none m-0 p-0 flex flex-col gap-3">
                  {current.findings
                    .filter((f) => f.scope === 'item')
                    .map((f) => (
                      <li key={f.refId} className="flex flex-col gap-1">
                        <p className="m-0 text-sm">
                          <span className="chip mr-2" style={f.cause === 'data-error' ? { color: 'var(--pink-ink)', borderColor: 'var(--pink)' } : undefined}>
                            {CAUSE_LABELS[f.cause]}
                          </span>
                          {f.note}
                        </p>
                        <div>
                          <button
                            className="btn btn-sm"
                            onClick={() =>
                              addLesson({ projectId: current.projectId, cause: f.cause, note: f.note, appliesTo: { projectType: currentProject.projectType, category: history.items.find((i) => i.id === f.refId)?.category } })
                            }
                          >
                            Save as lesson
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
                <div className="flex flex-wrap items-center gap-3">
                  <ProvenanceNote p={livePm[current.projectId] ? { promptVersion: 'postmortem', generatedBy: 'claude', generatedAt: '' } : pm?.provenance} what="Notes" />
                  <button className="btn btn-sm" disabled={!claudeLive || pmBusy} onClick={() => rerun(current.projectId)}>
                    Re-run with Claude
                  </button>
                  {pmBusy ? <Spinner /> : null}
                </div>
              </div>
            ) : (
              <p className="m-0 muted text-sm">
                Pick “Why” on a project to see what the post-mortem found. Across all projects: {[...causeCounts.entries()].map(([c, n]) => `${CAUSE_LABELS[c].toLowerCase()} ${n}`).join(', ') || 'loading'}.
              </p>
            )}
          </Box>

          <Box title={`Lessons (${allLessons.length})`} labelledBy="lessons-title">
            <p className="m-0 text-sm muted mb-3">The scope agent reads the top lessons for a project type before it splits the next brief. Calibration picks up the numbers on its own.</p>
            <ul className="list-none m-0 p-0 flex flex-col gap-3 max-h-[24rem] overflow-y-auto">
              {allLessons.slice(0, 40).map((l, i) => (
                <li key={`${l.projectId}-${i}`} className="text-sm">
                  <span className="mono text-xs muted">
                    {CAUSE_LABELS[l.cause]}
                    {l.appliesTo.projectType ? `, ${PROJECT_TYPE_LABELS[l.appliesTo.projectType]}` : ''}
                    {l.source === 'user' ? ', saved by you' : ''}
                  </span>
                  <p className="m-0">{l.note}</p>
                </li>
              ))}
            </ul>
          </Box>
        </div>
      </div>

      <div className="grid gap-12 md:grid-cols-2">
        <Box title="Jira history" labelledBy="jira-sync-title">
          <JiraSync />
        </Box>
        <Box title="Timesheet import" labelledBy="csv-title">
          <TimesheetImport />
        </Box>
      </div>
    </div>
  );
}
