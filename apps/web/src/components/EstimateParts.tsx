import { useMemo } from 'react';
import type { Estimate } from '@scopewise/shared';
import { ROLE_LABELS } from '@scopewise/shared';
import { workingDaysBetween } from '@scopewise/engine';
import { DitherBar, Swatch } from './Dither';
import { ExplainButton } from './Explain';
import { addCalendarDays, hours, shortDate } from '../lib/format';

/** Per-phase P50→P80 ranges, then the buffer as its own bar, then the commit line. */
export function PhaseRanges({ estimate }: { estimate: Estimate }) {
  const max = Math.max(...estimate.perPhase.map((p) => p.p80), estimate.buffer.total) * 1.08;
  const sumP50 = estimate.items.reduce((s, i) => s + i.p50, 0);
  const commitMax = estimate.commitHours * 1.04;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        {estimate.perPhase.map((ph) => {
          const n = estimate.items.filter((i) => i.phaseId === ph.phaseId).length;
          return (
            <div key={ph.phaseId} className="grid grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_auto] max-sm:grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 items-center py-2.5 border-b border-dashed" style={{ borderColor: 'var(--rule-soft)' }}>
              <div className="min-w-0">
                <p className="m-0 font-semibold text-sm truncate">{ph.name}</p>
                <p className="m-0 text-xs muted">
                  {ROLE_LABELS[ph.role]}, {n} item{n === 1 ? '' : 's'}
                </p>
              </div>
              <div className="max-sm:col-span-2 max-sm:row-start-2">
                <DitherBar
                  max={max}
                  height={16}
                  segments={[
                    { from: 0, to: ph.p50, density: 100, label: `P50 ${hours(ph.p50)}` },
                    { from: ph.p50, to: ph.p80, density: 50, label: `P50 to P80` },
                  ]}
                />
              </div>
              <div className="mono text-sm text-right whitespace-nowrap flex items-center gap-2 justify-end">
                <span>
                  {hours(ph.p50)}
                  <span className="muted">–</span>
                  {hours(ph.p80)}
                </span>
                <ExplainButton title={`${ph.name}: phase range`} explanation={estimate.explanations[`phase.${ph.phaseId}`]} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_auto] max-sm:grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 items-center">
          <div>
            <p className="m-0 font-semibold text-sm">Project buffer</p>
            <p className="m-0 text-xs muted">Held once, at the end</p>
          </div>
          <div className="max-sm:col-span-2 max-sm:row-start-2">
            <DitherBar
              max={max}
              height={16}
              segments={[
                { from: 0, to: estimate.buffer.task, density: 75, tone: 'pink', label: 'Task risk' },
                { from: estimate.buffer.task, to: estimate.buffer.task + estimate.buffer.missingInfo, density: 50, tone: 'pink', label: 'Open questions' },
                { from: estimate.buffer.task + estimate.buffer.missingInfo, to: estimate.buffer.total, density: 25, tone: 'pink', label: 'Absence' },
              ]}
            />
          </div>
          <div className="mono text-sm text-right flex items-center gap-2 justify-end">
            {hours(estimate.buffer.total)}
            <ExplainButton title="Project buffer" explanation={estimate.explanations['buffer.total']} />
          </div>
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 list-none m-0 p-0 text-sm sm:pl-[calc(min(11rem,30%)+1rem)]">
          <li className="inline-flex items-center gap-2">
            <Swatch density={75} tone="pink" /> Task risk {hours(estimate.buffer.task)} <ExplainButton title="Task buffer" explanation={estimate.explanations['buffer.task']} />
          </li>
          <li className="inline-flex items-center gap-2">
            <Swatch density={50} tone="pink" /> Open questions {hours(estimate.buffer.missingInfo)} <ExplainButton title="Missing-information buffer" explanation={estimate.explanations['buffer.missingInfo']} />
          </li>
          <li className="inline-flex items-center gap-2">
            <Swatch density={25} tone="pink" /> Absence {hours(estimate.buffer.availability)} <ExplainButton title="Availability buffer" explanation={estimate.explanations['buffer.availability']} />
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--rule)' }}>
        <div className="flex justify-between text-sm">
          <span className="font-semibold">Commit: work at P50 plus buffer</span>
          <span className="mono flex items-center gap-2">
            {hours(estimate.commitHours)} <ExplainButton title="Commit date" explanation={estimate.explanations['commitDate']} />
          </span>
        </div>
        <DitherBar
          max={commitMax}
          height={22}
          segments={[
            { from: 0, to: sumP50, density: 100, label: 'Σ P50' },
            { from: sumP50, to: estimate.commitHours, density: 50, tone: 'pink', label: 'Buffer' },
          ]}
        />
        <p className="text-xs muted m-0">Items are planned at their P50. The buffer is what keeps the promise, and it’s visible instead of hidden in every line.</p>
      </div>
    </div>
  );
}

/** Gantt-style timeline in working days: solid to the P50 end of each phase, dithered to P80. */
export function Timeline({ estimate, deadline, compact = false }: { estimate: Estimate; deadline?: string; compact?: boolean }) {
  const start = estimate.startDate;
  const deadlineDays = deadline ? workingDaysBetween(start, deadline) : undefined;
  const commitDays = workingDaysBetween(start, estimate.commitDate);
  const lastP80 = Math.max(...estimate.perPhase.map((p) => p.endDayP80), 1);
  const span = Math.max(lastP80, deadlineDays ?? 0, commitDays) * 1.06;
  const ticks = useMemo(() => {
    const out: { day: number; label: string }[] = [];
    const step = span > 60 ? 10 : 5;
    for (let d = 0; d <= span - step * 0.6; d += step) {
      // working days to calendar: 5 working days ≈ 7 calendar days
      out.push({ day: d, label: shortDate(addCalendarDays(start, Math.round((d / 5) * 7))).slice(4) });
    }
    return out;
  }, [span, start]);
  const pos = (d: number) => `${(d / span) * 100}%`;
  return (
    <div className="flex flex-col gap-1" role="img" aria-label={`Timeline: P50 finish ${estimate.p50Date}, P80 finish ${estimate.p80Date}${deadline ? `, deadline ${deadline}` : ''}.`}>
      <div className="relative">
        {estimate.perPhase.map((ph) => (
          <div key={ph.phaseId} className={`grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] gap-3 items-center ${compact ? 'py-1' : 'py-1.5'}`}>
            <span className="text-sm truncate">{ph.name}</span>
            <div className="relative" style={{ height: compact ? 12 : 16 }}>
              <span className="dither d-100 absolute top-0 bottom-0" style={{ left: pos(ph.startDay), width: pos(Math.max(0.15, ph.endDayP50 - ph.startDay)) }} />
              <span className="dither d-50 absolute top-0 bottom-0" style={{ left: pos(ph.endDayP50), width: pos(Math.max(0, ph.endDayP80 - ph.endDayP50)) }} />
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] gap-3 absolute inset-0 pointer-events-none" aria-hidden="true">
          <span />
          <div className="relative">
            {deadlineDays !== undefined ? (
              <div className="absolute top-0 bottom-0" style={{ left: pos(deadlineDays), borderLeft: '2px solid var(--pink)' }} />
            ) : null}
            <div className="absolute top-0 bottom-0" style={{ left: pos(commitDays), borderLeft: '1px dashed var(--blue)' }} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] gap-3" aria-hidden="true">
        <span />
        <div className="relative h-10 mono text-[11px] muted" style={{ borderTop: '1px solid var(--rule)' }}>
          {ticks.map((t) => (
            <span key={t.day} className="absolute top-1 whitespace-nowrap" style={{ left: pos(t.day) }}>
              <span className="block" style={{ marginLeft: -1 }}>
                |
              </span>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs muted sm:pl-[calc(min(9rem,30%)+0.75rem)]">
        <span className="inline-flex items-center gap-1.5">
          <Swatch density={100} /> to P50
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch density={50} /> to P80
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" style={{ borderLeft: '1px dashed var(--blue)', height: 10 }} /> commit {shortDate(estimate.commitDate)}
        </span>
        {deadline ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" style={{ borderLeft: '2px solid var(--pink)', height: 10 }} /> deadline {shortDate(deadline)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
