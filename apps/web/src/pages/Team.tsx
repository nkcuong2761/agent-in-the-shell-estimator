import { useMemo, useState } from 'react';
import type { JiraPushResponse, Role, TeamShape } from '@scopewise/shared';
import { ROLE_LABELS } from '@scopewise/shared';
import { whatIf } from '@scopewise/engine';
import { Box } from '../components/Ascii';
import { Timeline } from '../components/EstimateParts';
import { ExplainButton } from '../components/Explain';
import { DisabledNote, Spinner, Stepper } from '../components/ui';
import { api } from '../lib/api';
import { hours, longDate, pct, shortDate } from '../lib/format';
import { useActiveEstimate, useStore } from '../lib/store';

const ROLES: Role[] = ['pm', 'designer', 'engineer', 'qa', 'legal'];

function Compare({ label, before, after, better }: { label: string; before: string; after: string; better: boolean | null }) {
  const changed = before !== after;
  return (
    <div>
      <p className="text-sm muted m-0 mb-1.5">{label}</p>
      <p className="stat-value m-0 text-[2rem]" style={{ color: changed && better === false ? 'var(--pink-ink)' : changed && better ? 'var(--blue-ink)' : undefined }}>
        {after}
      </p>
      <p className="stat-help m-0">{changed ? `was ${before} with the squad as it is` : 'same as the squad as it is'}</p>
    </div>
  );
}

export function TeamPage() {
  const { ws, prep, estimate } = useActiveEstimate();
  const { update, history, viewMode, mode } = useStore();
  const [push, setPush] = useState<{ busy: boolean; result?: JiraPushResponse; error?: string }>({ busy: false });
  const readOnly = viewMode === 'overseer';
  const squad = history.squads.find((s) => s.id === ws?.squadId);
  const baseline = useMemo<TeamShape>(() => {
    const t: TeamShape = {};
    for (const m of squad?.members ?? []) t[m.role] = m.count;
    return t;
  }, [squad]);

  const opts = { answeredQuestionIds: ws?.answered, droppedItemIds: ws?.dropped, deadline: ws?.deadline };
  const now = useMemo(() => (prep && ws ? whatIf(prep, ws.teamShape, opts) : undefined), [prep, ws?.teamShape, ws?.answered, ws?.dropped, ws?.deadline]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => (prep && ws ? whatIf(prep, baseline, opts) : undefined), [prep, baseline, ws?.answered, ws?.dropped, ws?.deadline]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ws) return null;
  if (!now || !base) return <Spinner label="Simulating" />;

  const setRole = (r: Role, v: number) => update(ws.id, { teamShape: { ...ws.teamShape, [r]: v } });
  const toggleItem = (id: string) => update(ws.id, { dropped: ws.dropped.includes(id) ? ws.dropped.filter((d) => d !== id) : [...ws.dropped, id] });
  const usedRoles = new Set(ws.scope.items.map((i) => i.role));
  const jiraLive = mode.kind === 'live' && mode.health.features.jira;

  const pushToJira = async (dryRun: boolean) => {
    if (!estimate) return;
    setPush({ busy: true });
    try {
      const result = await api.jiraPush({
        title: ws.title,
        summary: ws.scope.summary,
        estimateUrl: window.location.href,
        projectType: ws.scope.projectType,
        size: ws.scope.size,
        dryRun,
        items: estimate.items.map((c) => {
          const it = ws.scope.items.find((i) => i.id === c.itemId);
          return { id: c.itemId, title: it?.title ?? c.itemId, phaseId: c.phaseId, category: c.category, p50Hours: c.p50, p80Hours: c.p80 };
        }),
      });
      setPush({ busy: false, result });
    } catch (err) {
      setPush({ busy: false, error: err instanceof Error ? err.message : 'Push failed.' });
    }
  };

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <p className="text-sm muted m-0">{squad?.name ?? 'Squad'}, fictional capacity from 18 months of worklogs</p>
        <h1 className="h-page m-0">Team &amp; timeline</h1>
        <p className="lede m-0">More people finish sooner, but every extra person in a role adds {Math.round((squad?.stats.coordinationOverheadPerExtra ?? 0.1) * 100)}% coordination time to that role’s work.</p>
      </header>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Box title="Headcount per role" labelledBy="headcount-title">
          <fieldset className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0" disabled={readOnly}>
            <legend className="sr-only">Headcount per role</legend>
            {ROLES.map((r) => (
              <div key={r} className="flex items-center justify-between gap-3">
                <div>
                  <p className="m-0 text-sm font-semibold">{ROLE_LABELS[r]}</p>
                  <p className="m-0 text-xs muted">
                    {usedRoles.has(r) ? `squad has ${baseline[r] ?? 0}` : 'no work in this brief'}
                    {usedRoles.has(r) && (ws.teamShape[r] ?? 0) === 0 ? ', borrowing one' : ''}
                  </p>
                </div>
                <Stepper label={ROLE_LABELS[r]} value={ws.teamShape[r] ?? 0} onChange={(v) => setRole(r, v)} min={0} max={10} />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <button className="btn btn-sm" disabled={readOnly} onClick={() => update(ws.id, { teamShape: baseline })}>
                Reset to squad
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-3" style={{ borderTop: '1px dashed var(--rule)' }}>
              <div className="field">
                <label htmlFor="start">Start</label>
                <input id="start" type="date" className="input" value={ws.startDate} disabled={readOnly} onChange={(e) => e.target.value && update(ws.id, { startDate: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="deadline">Deadline</label>
                <input id="deadline" type="date" className="input" value={ws.deadline ?? ''} disabled={readOnly} onChange={(e) => update(ws.id, { deadline: e.target.value || undefined })} />
              </div>
            </div>
            {squad?.plannedLeave.length ? (
              <p className="text-xs m-0" style={{ color: 'var(--pink-ink)' }}>
                {squad.plannedLeave.map((l) => `${l.note}: ${longDate(l.start)} to ${longDate(l.end)}`).join('. ')}. The simulation removes that capacity.
              </p>
            ) : null}
          </fieldset>
        </Box>

        <div className="flex flex-col gap-10">
          <div className="grid gap-8 sm:grid-cols-3" aria-live="polite">
            <Compare label="P50 finish" before={shortDate(base.p50Date)} after={shortDate(now.p50Date)} better={now.p50Date < base.p50Date} />
            <Compare label="On-time chance" before={pct(base.onTimeProbability)} after={pct(now.onTimeProbability)} better={(now.onTimeProbability ?? 0) > (base.onTimeProbability ?? 0)} />
            <Compare label="Effort at P50" before={hours(base.total.p50)} after={hours(now.total.p50)} better={now.total.p50 < base.total.p50} />
          </div>
          <div className="flex items-center gap-2 text-sm muted">
            P80 finish {shortDate(now.p80Date)}, commit {shortDate(now.commitDate)}
            <ExplainButton title="P50 finish" explanation={now.explanations['p50Date']} />
            <span className="mono text-[11px]">
              {now.runs.toLocaleString('en-US')} runs, {now.elapsedMs} ms
            </span>
          </div>
          <Box title="Timeline" labelledBy="team-timeline">
            <Timeline estimate={now} deadline={ws.deadline} compact />
          </Box>
        </div>
      </div>

      <Box title="Trim scope" labelledBy="trim-title">
        <p className="m-0 text-sm muted mb-4">Untick an item to see what dropping it does to the dates. Dropped items stay listed so you can bring them back.</p>
        <ul className="list-none m-0 p-0 grid gap-x-8 gap-y-2 md:grid-cols-2">
          {ws.scope.items.map((it) => {
            const cal = estimate?.items.find((c) => c.itemId === it.id);
            const on = !ws.dropped.includes(it.id);
            return (
              <li key={it.id}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" className="mt-1.5 accent-[var(--ink)]" checked={on} disabled={readOnly} onChange={() => toggleItem(it.id)} />
                  <span className={on ? '' : 'line-through muted'}>
                    {it.title}
                    <span className="mono text-xs muted ml-2">{cal ? hours(cal.p50) : ''}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Box>

      <Box title="Push to Jira" labelledBy="jira-title">
        <div className="flex flex-col gap-4">
          <p className="m-0 measure">
            Creates one epic for “{ws.title}” and {estimate?.items.length ?? ws.scope.items.length} stories, each with its P50 as the original estimate and phase and category labels, linking back to this estimate.
          </p>
          <div className="flex flex-wrap gap-3 items-center">
            <button className="btn" disabled={!jiraLive || readOnly || push.busy} onClick={() => pushToJira(true)}>
              Preview what will be created
            </button>
            <button className="btn btn-primary" disabled={!jiraLive || readOnly || push.busy} onClick={() => pushToJira(false)}>
              Push to Jira
            </button>
            {push.busy ? <Spinner label="Talking to Jira" /> : null}
          </div>
          {!jiraLive ? (
            <DisabledNote>{mode.kind === 'live' ? 'The API is up, but no Jira site is configured for it.' : 'Pushing to Jira needs the Scopewise API, which holds the Jira credentials. This site is in demo mode.'}</DisabledNote>
          ) : null}
          {readOnly ? <DisabledNote>Overseer view is read only. Switch to Manager view to push.</DisabledNote> : null}
          {push.error ? (
            <p role="alert" className="m-0 text-sm" style={{ color: 'var(--pink-ink)' }}>
              {push.error}
            </p>
          ) : null}
          {push.result ? (
            <div className="text-sm">
              <p className="m-0 font-semibold">
                {push.result.dryRun ? 'Preview: nothing created yet' : `Created ${push.result.epicKey} with ${push.result.storyKeys.length} stories`}
              </p>
              <pre className="mono text-[12px] m-0 mt-2 whitespace-pre-wrap">{push.result.plan.join('\n')}</pre>
            </div>
          ) : null}
        </div>
      </Box>
    </div>
  );
}
