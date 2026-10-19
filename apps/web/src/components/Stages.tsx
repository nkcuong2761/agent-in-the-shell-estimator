import { useState } from 'react';
import type { Estimate, ScopeResult } from '@scopewise/shared';
import { copy } from '../copy';
import { toStages } from '../present/stages';
import { observedBias } from '../state/engine';
import { Card, Icon, Label } from './ui';

/** "What happens when": one row per stage on a weeks scale; rows expand to their work items with source chips. */
export function Stages({ est, scope }: { est: Estimate; scope: ScopeResult }) {
  const s = toStages(est, scope, observedBias());
  const [open, setOpen] = useState<string | null>(null);
  const scale = Math.max(1, Math.ceil(est.finishDays.p50 / 5));
  const pct = (w: number) => `${Math.min(100, (w / scale) * 100)}%`;
  const ticks = Array.from({ length: scale + 1 }, (_, i) => i).filter((i) => scale <= 12 || i % 2 === 0);
  return (
    <Card id="est-stages" inner="p-5 sm:p-6 flex flex-col gap-4" aria-labelledby="stages-title">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <Label idx="§ 05">Stages</Label>
          <h2 id="stages-title" className="h-card m-0">
            {copy.whatWhen}
          </h2>
        </div>
        <span className="label">{copy.weeksFromKickoff}</span>
      </div>
      <div className="grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] max-sm:grid-cols-1 gap-x-4">
        <span className="max-sm:hidden" />
        <div className="relative h-5 mono text-[11px] muted" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <ul className="list-none m-0 p-0 flex flex-col">
        {s.rows.map((r) => {
          const isOpen = open === r.id;
          return (
            <li key={r.id}>
              <button className="row-button px-2 py-3 grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] max-sm:grid-cols-1 gap-x-4 gap-y-2 items-center" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                <span className="flex items-start gap-2 min-w-0">
                  <Icon name="chevron" size={14} className="mt-1 shrink-0 muted transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
                  <span className="min-w-0">
                    <span className="block font-semibold leading-snug">{r.name}</span>
                    <span className="block text-[13px] muted mono">
                      {r.duration}
                      {r.runsLong ? <span style={{ color: 'var(--warning)' }}> · {copy.runsLong}</span> : null}
                    </span>
                  </span>
                </span>
                <span className="track block" aria-hidden="true">
                  <span className="seg-likely" style={{ left: pct(r.startWeek), width: pct(Math.max(0.12, r.endWeek - r.startWeek)) }} />
                </span>
              </button>
              {isOpen ? (
                <ul className="list-none m-0 mb-3 p-0 flex flex-col gap-2 sm:ml-8 enter">
                  {r.items.map((it) => (
                    <li key={it.id} className="panel px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{it.title}</span>
                        <span className="block text-[13px] muted mono">{it.hours}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {it.sources.map((src, i) => (
                          <span key={i} className="chip" title={src.quote ? `“${src.quote}”` : undefined}>
                            <Icon name="file" size={13} />
                            {src.label}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
