import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Estimate } from '@scopewise/shared';
import { PERSONA_LABELS } from '@scopewise/shared';
import { Box } from '../components/Ascii';
import { DitherHistogram, Swatch } from '../components/Dither';
import { PhaseRanges, Timeline } from '../components/EstimateParts';
import { ExplainButton } from '../components/Explain';
import { ConfidenceBadge, ProvenanceNote, Spinner } from '../components/ui';
import { PROJECT_TYPE_LABELS } from '../lib/data';
import { hours, longDate, pct, plural, shortDate } from '../lib/format';
import { useActiveEstimate, useStore, type Workspace } from '../lib/store';

function Headline({ e, ws, delta }: { e: Estimate; ws: Workspace; delta: { p50: number; p80: number } | null }) {
  const onTime = e.onTimeProbability;
  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <p className="text-sm muted m-0 mb-2">Effort range, P50 to P80</p>
        <p className="stat-value m-0 flex flex-wrap items-baseline gap-x-3" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.25rem)' }}>
          <span>
            {Math.round(e.total.p50)}
            <span className="muted">–</span>
            {Math.round(e.total.p80)}
            <span className="text-[0.45em] muted ml-1">hours</span>
          </span>
        </p>
        <div className="flex gap-1.5 mt-2">
          <ExplainButton title="P50 effort" label="P50" explanation={e.explanations['total.p50']} />
          <ExplainButton title="P80 effort" label="P80" explanation={e.explanations['total.p80']} />
        </div>
        <p className="stat-help">
          Half of {e.runs.toLocaleString('en-US')} simulated outcomes need less than {hours(e.total.p50)}; 80% need less than {hours(e.total.p80)}.
        </p>
        {delta ? (
          <p className="mono text-sm m-0 mt-2" role="status" style={{ color: 'var(--blue-ink)' }}>
            Range was {Math.round(delta.p50)}–{Math.round(delta.p80)}h, now {Math.round(e.total.p80 - e.total.p50)}h wide instead of {Math.round(delta.p80 - delta.p50)}h.
          </p>
        ) : null}
      </div>
      <div>
        <p className="text-sm muted m-0 mb-2">Commit date</p>
        <p className="stat-value m-0 text-[2.25rem] md:text-[2.6rem]">{shortDate(e.commitDate)}</p>
        <div className="mt-2">
          <ExplainButton title="Commit date" explanation={e.explanations['commitDate']} />
        </div>
        <p className="stat-help">
          P50 work plus the {hours(e.buffer.total)} buffer. P50 finish {shortDate(e.p50Date)}, P80 finish {shortDate(e.p80Date)}.
        </p>
      </div>
      <div>
        <p className="text-sm muted m-0 mb-2">On time for {ws.deadline ? shortDate(ws.deadline) : 'the deadline'}</p>
        <p className="stat-value m-0 text-[2.25rem] md:text-[2.6rem]" style={{ color: onTime !== null && onTime < 0.5 ? 'var(--pink-ink)' : undefined }}>
          {pct(onTime)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ExplainButton title="Chance of meeting the deadline" explanation={e.explanations['onTime']} />
          <ConfidenceBadge level={e.confidence} />
          <ExplainButton title="Confidence" explanation={e.explanations['confidence']} />
        </div>
        <p className="stat-help">{onTime === null ? 'No client deadline set.' : `Share of simulated schedules that finish on or before ${longDate(ws.deadline)}.`}</p>
      </div>
    </div>
  );
}

function Questions({ e, ws }: { e: Estimate; ws: Workspace }) {
  const { update, viewMode } = useStore();
  const answered = ws.scope.missingInfo.filter((q) => ws.answered.includes(q.id));
  const readOnly = viewMode === 'overseer';
  return (
    <div className="flex flex-col gap-4">
      {e.rankedQuestions.length === 0 ? <p className="m-0 muted">Every question is answered. The range now only carries task and capacity risk.</p> : null}
      <ol className="list-none m-0 p-0 flex flex-col">
        {e.rankedQuestions.map((q, i) => (
          <li key={q.questionId} className="grid grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3 gap-y-2 py-3 border-b border-dashed" style={{ borderColor: 'var(--rule-soft)' }}>
            <span className="mono text-sm muted pt-0.5">{i + 1}.</span>
            <div className="min-w-0">
              <p className="m-0 font-semibold leading-snug">{q.question}</p>
              <p className="m-0 text-sm mt-1 flex items-center gap-2 flex-wrap">
                <span style={{ color: 'var(--blue-ink)' }}>{i === 0 ? 'Ask this first: it' : 'It'} narrows the range by ~{hours(q.narrowsByH)}.</span>
                <ExplainButton title="Value of this answer" explanation={e.explanations[`question.${q.questionId}`]} />
                <span className="muted text-xs">
                  {q.impact} impact, {plural(q.affectedItemIds.length, 'item')}
                </span>
              </p>
            </div>
            <div className="col-start-2 sm:col-start-3 sm:row-start-1">
              <button className="btn btn-sm" disabled={readOnly} onClick={() => update(ws.id, { answered: [...ws.answered, q.questionId] })}>
                Mark answered
              </button>
            </div>
          </li>
        ))}
      </ol>
      {answered.length ? (
        <div className="text-sm">
          <p className="muted m-0 mb-1">Answered</p>
          <ul className="list-none m-0 p-0 flex flex-col gap-1">
            {answered.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-3">
                <span className="line-through decoration-1" style={{ color: 'var(--graphite)' }}>
                  {q.question}
                </span>
                <button className="btn btn-sm" disabled={readOnly} onClick={() => update(ws.id, { answered: ws.answered.filter((a) => a !== q.id) })}>
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs muted m-0">Marking a question answered removes its uncertainty from the simulation. In live mode, Ask can also take the actual answer and re-scope the items.</p>
    </div>
  );
}

function ItemsTable({ e, ws }: { e: Estimate; ws: Workspace }) {
  const flags = new Set(ws.panel?.disagreementFlags ?? []);
  const byId = new Map(ws.scope.items.map((i) => [i.id, i]));
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[44rem]">
        <thead>
          <tr>
            <th>Work item</th>
            <th className="r">Panel likely</th>
            <th className="r">History blend</th>
            <th className="r">Bias</th>
            <th className="r">P50</th>
            <th className="r">P80</th>
          </tr>
        </thead>
        <tbody>
          {e.items.map((c) => {
            const it = byId.get(c.itemId);
            return (
              <tr key={c.itemId}>
                <td>
                  <span className="font-semibold">{it?.title}</span>
                  <span className="block text-xs muted">
                    {ws.scope.phases.find((p) => p.id === c.phaseId)?.name}, {c.category}
                    {flags.has(c.itemId) ? <span style={{ color: 'var(--pink-ink)' }}>, panel disagrees</span> : null}
                    {c.openSpread > 1 ? <span>, waiting on {plural(it?.affectedByQuestions.filter((q) => !ws.answered.includes(q)).length ?? 0, 'answer')}</span> : null}
                  </span>
                </td>
                <td className="r mono">{hours(c.panel.m)}</td>
                <td className="r mono whitespace-nowrap">
                  {hours(c.m)} <ExplainButton title={`${it?.title}: blend`} explanation={e.explanations[`item.${c.itemId}`]} />
                </td>
                <td className="r mono whitespace-nowrap">
                  ×{c.biasFactor.toFixed(2)} <ExplainButton title={`${c.category}: bias`} explanation={e.explanations[`bias.${c.category}`]} />
                </td>
                <td className="r mono">{hours(c.p50)}</td>
                <td className="r mono whitespace-nowrap">
                  {hours(c.p80)} <ExplainButton title={`${it?.title}: range`} explanation={e.explanations[`item.${c.itemId}.range`]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Analogs({ e, ws }: { e: Estimate; ws: Workspace }) {
  const { history } = useStore();
  const projectName = new Map(history.projects.map((p) => [p.id, p.name]));
  const byId = new Map(ws.scope.items.map((i) => [i.id, i]));
  const rc = e.referenceClass;
  const biggest = [...e.items].sort((a, b) => b.p50 - a.p50).slice(0, 4);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="m-0 text-lg">
          {rc.n ? (
            <>
              Projects like this took{' '}
              <span className="mono">
                {hours(rc.p20)}–{hours(rc.p80)}
              </span>
              .
            </>
          ) : (
            'No closed projects of this type yet.'
          )}
        </p>
        <ExplainButton title="Reference class" explanation={e.explanations['referenceClass']} />
        <p className="text-sm muted m-0 w-full">
          Middle 60% of {plural(rc.n, 'closed project')} of the same type{rc.relaxed ? ' (any size)' : ' and size'}; median {hours(rc.median)}. This estimate’s P50 is {hours(e.total.p50)}.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {biggest.map((c) => {
          const a = e.analogs.find((x) => x.itemId === c.itemId);
          return (
            <div key={c.itemId} className="flex flex-col gap-2">
              <p className="m-0 font-semibold text-sm flex items-center gap-2">
                {byId.get(c.itemId)?.title}
                <ExplainButton title="Similar past items" explanation={e.explanations[`analogs.${c.itemId}`]} />
              </p>
              <ul className="list-none m-0 p-0 flex flex-col gap-1">
                {a?.matches.map((m) => (
                  <li key={m.historyItemId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-sm">
                    <span className="truncate muted" title={projectName.get(m.projectId)}>
                      {m.title}, {projectName.get(m.projectId)?.split(':')[0]}
                    </span>
                    <span className="mono">
                      {hours(m.estimateH)} <span className="muted">est,</span> {hours(m.actualH)} <span className="muted">actual</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Panel({ ws }: { ws: Workspace }) {
  const panel = ws.panel;
  if (!panel) return <p className="m-0 muted">No estimator panel ran for this brief; the scope agent’s own guesses are used.</p>;
  const items = ws.scope.items;
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[40rem]">
        <thead>
          <tr>
            <th>Work item</th>
            {panel.agents.map((a) => (
              <th key={a.persona} className="r">
                {PERSONA_LABELS[a.persona]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>
                {it.title}
                {panel.disagreementFlags.includes(it.id) ? (
                  <span className="block text-xs" style={{ color: 'var(--pink-ink)' }}>
                    Still disagree after round 2
                  </span>
                ) : null}
              </td>
              {panel.agents.map((a, ai) => {
                const g = a.items.find((x) => x.itemId === it.id);
                const r1 = panel.round1?.[ai]?.items.find((x) => x.itemId === it.id);
                return (
                  <td key={a.persona} className="r mono whitespace-nowrap" title={g?.reason}>
                    {r1 && g && Math.round(r1.m) !== Math.round(g.m) ? (
                      <span className="muted">
                        {Math.round(r1.m)}
                        {' > '}
                      </span>
                    ) : null}
                    {g ? hours(g.m) : 'n/a'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs muted mt-2 m-0">Likely hours per persona, round 1 then round 2. Hover a figure for the persona’s reason.</p>
    </div>
  );
}

export function EstimatePage() {
  const { ws, estimate: e, pending } = useActiveEstimate();
  const [delta, setDelta] = useState<{ p50: number; p80: number } | null>(null);
  const last = useRef<{ answered: number; p50: number; p80: number } | null>(null);

  useEffect(() => {
    if (!e || !ws) return;
    const prev = last.current;
    if (prev && prev.answered !== ws.answered.length) setDelta({ p50: prev.p50, p80: prev.p80 });
    last.current = { answered: ws.answered.length, p50: e.total.p50, p80: e.total.p80 };
  }, [e, ws]);

  if (!ws) return null;
  if (!e) return <Spinner label="Running 5,000 simulations" />;
  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <p className="text-sm muted m-0">
          {PROJECT_TYPE_LABELS[ws.scope.projectType]}, size {ws.scope.size}, for {ws.client}
        </p>
        <h1 className="h-page m-0">{ws.title}</h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <ProvenanceNote p={ws.scopeProvenance} what="Scope" />
          <ProvenanceNote p={ws.panelProvenance} what="Panel" />
          <p className="mono text-[11px] muted m-0">
            Numbers: engine, {e.runs.toLocaleString('en-US')} runs, seed {e.seed}, {e.elapsedMs} ms{pending ? ', updating' : ''}
          </p>
        </div>
      </header>

      <Headline e={e} ws={ws} delta={delta} />

      <Box title="Simulated outcomes" labelledBy="dist-title">
        <DitherHistogram
          histogram={e.hoursHistogram}
          p50={e.total.p50}
          p80={e.total.p80}
          markers={[{ at: e.commitHours, label: `commit ${Math.round(e.commitHours)}h`, tone: 'pink' }]}
          height={170}
          ariaLabel={`Histogram of ${e.runs} simulated totals. P50 ${Math.round(e.total.p50)} hours, P80 ${Math.round(e.total.p80)} hours.`}
        />
        <p className="text-sm muted m-0 mt-1 flex flex-wrap gap-x-4 gap-y-1 items-center">
          <span>Each column is a band of total hours; darker ink means more certain.</span>
          <span className="inline-flex items-center gap-1.5">
            <Swatch density={100} /> up to P50
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Swatch density={50} /> P50 to P80
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Swatch density={12} tone="graphite" /> beyond P80
          </span>
        </p>
      </Box>

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Box title="Phases and buffer" labelledBy="phases-title">
          <PhaseRanges estimate={e} />
        </Box>
        <Box title={`Answer a question (${e.rankedQuestions.length} open)`} labelledBy="questions-title">
          <Questions e={e} ws={ws} />
        </Box>
      </div>

      <Box title="Timeline in working days" labelledBy="timeline-title">
        <Timeline estimate={e} deadline={ws.deadline} />
        <p className="text-sm muted m-0 mt-3">
          Change headcount on <Link className="link" to={`/team/${ws.id}`}>Team &amp; timeline</Link> to see the finish date move.
        </p>
      </Box>

      <Box title="What similar work took" labelledBy="analogs-title">
        <Analogs e={e} ws={ws} />
      </Box>

      <Box title="Work items, calibrated" labelledBy="items-title">
        <ItemsTable e={e} ws={ws} />
      </Box>

      <Box title="Estimator panel" labelledBy="panel-title">
        <Panel ws={ws} />
      </Box>
    </div>
  );
}
