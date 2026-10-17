import { useMemo, useState } from 'react';
import type { Conversation, Estimate, ScopeResult, TeamShape } from '@scopewise/shared';
import { copy } from '../copy';
import { toClientEmail, toHeadline, toQuestions, toStages, toWhyBullets } from '../present';
import { observedBias, squadStatsOf } from '../state/engine';
import { useConversations } from '../state/conversations';
import { seed } from '../lib/data';
import { readStore, writeStore } from '../lib/storage';
import { useMethods } from './Explain';
import { Card, Icon, SureBars } from './ui';

function Headline({ est, team, onChangeTeam }: { est: Estimate; team: TeamShape; onChangeTeam: () => void }) {
  const h = toHeadline(est, team);
  return (
    <Card inner="p-5 sm:p-6 flex flex-col gap-6">
      <div>
        <p className="m-0 text-[15px]" style={{ color: 'var(--ink-2)' }}>
          {copy.takesAbout}
        </p>
        <p className="big-number m-0 mt-1">{h.range}</p>
        <p className="m-0 mt-2 text-[15px]" style={{ color: 'var(--ink-2)' }}>
          {copy.plannedFor(h.team)} ·{' '}
          <button className="link" onClick={onChangeTeam}>
            {copy.changeTeam}
          </button>
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="panel p-4">
          <p className="m-0 text-sm muted">{copy.mostLikely}</p>
          <p className="m-0 mt-1 text-2xl font-semibold tracking-tight num">{h.mostLikely}</p>
        </div>
        <div className="panel p-4">
          <p className="m-0 text-sm muted">{copy.safeDate}</p>
          <p className="m-0 mt-1 text-2xl font-semibold tracking-tight num">{h.safeDate}</p>
          <p className="m-0 mt-1 text-[13px] muted">{copy.includesMargin(h.margin)}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[15px]" style={{ color: 'var(--ink-2)' }}>
            {copy.howSure}
          </span>
          <SureBars sure={h.sure} />
        </div>
        <p className="m-0 text-[15px] muted">{h.moveNote}</p>
      </div>
    </Card>
  );
}

function Stages({ est, scope }: { est: Estimate; scope: ScopeResult }) {
  const s = toStages(est, scope, observedBias());
  const [open, setOpen] = useState<string | null>(null);
  const pct = (w: number) => `${Math.min(100, (w / s.scaleWeeks) * 100)}%`;
  const ticks = Array.from({ length: s.scaleWeeks + 1 }, (_, i) => i).filter((i) => s.scaleWeeks <= 12 || i % 2 === 0);
  const p80End = new Map(est.perPhase.map((p) => [p.phaseId, p.endDayP80 / 5]));
  return (
    <Card inner="p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="h-card m-0">{copy.whatWhen}</h3>
        <span className="text-[13px] muted">{copy.weeksFromKickoff}</span>
      </div>
      <div className="grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] max-sm:grid-cols-1 gap-x-4">
        <span className="max-sm:hidden" />
        <div className="relative h-5 text-[12px] muted num" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1">
        {s.rows.map((r) => {
          const isOpen = open === r.id;
          return (
            <li key={r.id}>
              <button className="row-button px-2 py-2.5 grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] max-sm:grid-cols-1 gap-x-4 gap-y-2 items-center" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                <span className="flex items-start gap-2 min-w-0">
                  <Icon name="chevron" size={16} className="mt-0.5 shrink-0 muted transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
                  <span className="min-w-0">
                    <span className="block font-medium leading-snug">{r.name}</span>
                    <span className="block text-[13px] muted">
                      {r.duration}
                      {r.runsLong ? <span style={{ color: 'var(--warning)' }}> · {copy.runsLong}</span> : null}
                    </span>
                  </span>
                </span>
                <span className="track block" aria-hidden="true">
                  <span className="seg-likely" style={{ left: pct(r.startWeek), width: `calc(${pct(Math.max(0.12, r.endWeek - r.startWeek))})` }} />
                  <span className="seg-stipple" style={{ left: pct(r.endWeek), width: pct(Math.max(0, (p80End.get(r.id) ?? r.endWeek) - r.endWeek)) }} />
                </span>
              </button>
              {isOpen ? (
                <ul className="list-none m-0 mt-1 mb-3 p-0 flex flex-col gap-2 sm:ml-8 enter">
                  {r.items.map((it) => (
                    <li key={it.id} className="panel px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{it.title}</span>
                        <span className="block text-[13px] muted">{it.hours}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {it.sources.map((src, i) => (
                          <span key={i} className="chip text-[13px]" title={src.quote ? `“${src.quote}”` : undefined}>
                            <Icon name="file" size={14} />
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
        <li className="px-2 py-2.5 grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] max-sm:grid-cols-1 gap-x-4 gap-y-2 items-center">
          <span className="pl-6">
            <span className="block font-medium leading-snug">
              {copy.marginRow} <span className="muted font-normal">— {copy.marginRowNote}</span>
            </span>
            <span className="block text-[13px] muted">{s.margin.duration}</span>
          </span>
          <span className="track block" aria-hidden="true">
            <span className="seg-margin seg-stipple" style={{ left: pct(s.margin.startWeek), width: pct(Math.max(0.12, s.margin.endWeek - s.margin.startWeek)) }} />
          </span>
        </li>
      </ul>
    </Card>
  );
}

function Questions({ est, scope, conv }: { est: Estimate; scope: ScopeResult; conv: Conversation }) {
  const { answer, readOnly } = useConversations();
  const qs = toQuestions(est, scope);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [answering, setAnswering] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const email = useMemo(() => toClientEmail(scope, qs), [scope, qs]);
  if (!qs.length) return null;
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    window.setTimeout(() => setCopied(null), 3000);
  };
  return (
    <Card inner="p-5 sm:p-6 flex flex-col gap-4">
      <div>
        <h3 className="h-card m-0">{copy.askClient}</h3>
        <p className="m-0 mt-1 text-[15px] muted">{copy.askClientSub}</p>
      </div>
      <ol className="m-0 pl-5 flex flex-col gap-3">
        {qs.map((q) => (
          <li key={q.id} className="pl-1">
            <p className="m-0 font-medium leading-snug">{q.question}</p>
            <p className="m-0 text-[14px] muted mt-0.5">{q.reason}</p>
            {answering ? (
              <label className="block mt-2">
                <span className="sr-only">{copy.answerPlaceholder}</span>
                <input className="input w-full" placeholder={copy.answerPlaceholder} value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
              </label>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {answering ? (
          <>
            <button
              className="btn btn-primary btn-sm"
              disabled={!Object.values(answers).some((v) => v.trim())}
              onClick={() => {
                answer(
                  conv.id,
                  qs.map((q) => ({ questionId: q.questionId ?? q.id, question: q.question, text: answers[q.id] ?? '' })),
                );
                setAnswering(false);
                setAnswers({});
              }}
            >
              {copy.submitAnswers}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAnswering(false)}>
              {copy.cancel}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" onClick={copyEmail}>
              <Icon name="copy" size={16} />
              {copy.copyEmail}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={readOnly} onClick={() => setAnswering(true)}>
              {copy.knowAnswers}
            </button>
          </>
        )}
        {copied ? (
          <span className="text-[14px]" role="status" style={{ color: copied === 'ok' ? 'var(--success)' : 'var(--warning)' }}>
            {copied === 'ok' ? copy.copied : copy.copyFailed}
          </span>
        ) : null}
      </div>
      {copied === 'fail' ? <pre className="panel p-4 m-0 whitespace-pre-wrap text-[14px] leading-relaxed">{email}</pre> : null}
    </Card>
  );
}

const METHOD_KEYS: [string, string][] = [
  ['total.p50', 'Most likely amount of work'],
  ['total.p80', 'Safe amount of work'],
  ['p50Date', 'Most likely finish date'],
  ['commitDate', 'Safe date to promise'],
  ['buffer.total', 'Safety margin'],
  ['buffer.task', 'Margin for ordinary surprises'],
  ['buffer.missingInfo', 'Margin for open questions'],
  ['buffer.availability', 'Margin for time off'],
  ['confidence', 'How sure the estimate is'],
  ['referenceClass', 'Similar finished projects'],
  ['correlation', 'Items running late together'],
  ['panel', 'The three estimators'],
  ['onTime', 'Chance of meeting the deadline'],
];

function Why({ est, conv }: { est: Estimate; conv: Conversation }) {
  const openMethods = useMethods();
  const [initiallyOpen] = useState(() => !readStore<boolean>('sw-why-seen', false));
  const bullets = toWhyBullets(est, seed.projects, squadStatsOf(conv), observedBias());
  return (
    <div className="bezel">
      <details className="bezel-core group" open={initiallyOpen} onToggle={() => writeStore('sw-why-seen', true)}>
        <summary className="list-none cursor-pointer p-5 sm:px-6 flex items-center justify-between gap-3">
          <h3 className="h-card m-0">{copy.why}</h3>
          <Icon name="down" className="muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-5 sm:px-6 pb-5 -mt-1 flex flex-col gap-3">
          <ul className="m-0 pl-5 flex flex-col gap-2 text-[15px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div>
            <button
              className="link text-[15px]"
              onClick={() =>
                openMethods({
                  title: conv.title,
                  intro: 'Every number on the estimate, with the method, the formula and the inputs that produced it.',
                  entries: METHOD_KEYS.filter(([k]) => est.explanations[k]).map(([k, title]) => ({ title, explanation: est.explanations[k]! })),
                })
              }
            >
              {copy.fullWorking}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

export function EstimateView({ est, conv, scope, team, current, onChangeTeam }: { est: Estimate; conv: Conversation; scope: ScopeResult; team: TeamShape; current: boolean; onChangeTeam: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Headline est={est} team={team} onChangeTeam={onChangeTeam} />
      <Stages est={est} scope={scope} />
      {current ? <Questions est={est} scope={scope} conv={conv} /> : null}
      <Why est={est} conv={conv} />
    </div>
  );
}
