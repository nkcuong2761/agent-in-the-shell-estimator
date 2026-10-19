import { useMemo, useState, type ReactNode } from 'react';
import type { AiPlan, AiToolKind, AiTools, BufferRisk, Conversation, Estimate, EstimateSpec, Role, ScopeResult } from '@scopewise/shared';
import { capitalise, copy, roleWord } from '../copy';
import { useStore } from '../lib/useStore';
import { pickedFrom, suggestedOpportunities, suggestedRisks, type Suggestion } from '../present/adjustments';
import { bufferAdjustment, historyAdjustment, leaveAdjustment, meetsDue, signedHours, toForecast, type Adjustment } from '../present/forecast';
import { fmtNum, formatDate, halfWeeks, rolePhrase, sd } from '../present/format';
import { howSure } from '../present/headline';
import { toWhy } from '../present/why';
import { useConversations } from '../state/conversations';
import { ROLE_ORDER, neededRoles, observedBias, squadOf, squadStatsOf, type Plan } from '../state/engine';
import { allPostmortems, historyFor, usePostmortems } from '../state/history';
import { AI_TOOL_KINDS, CY, FORECAST_KEY, bufferExtraHours, hasTools, type ForecastFlags } from '../state/policy';
import { DefaultHoursModal, DefaultTeamModal, DefaultToolsModal } from './DefaultsModals';
import { useMethods } from './Explain';
import { DateField, PlanPicker, Stepper } from './fields';
import { Card, Icon, Label, SureBars, Tag } from './ui';

const METHOD_KEYS: [string, string][] = [
  ['total.p50', 'Most likely amount of work'],
  ['total.p80', 'Safe amount of work'],
  ['p50Date', 'Most likely finish date'],
  ['commitDate', 'Safe date to promise'],
  ['buffer.total', 'Safety margin'],
  ['confidence', 'How sure the estimate is'],
  ['referenceClass', 'Similar finished projects'],
  ['correlation', 'Items running late together'],
  ['panel', 'The three estimators'],
  ['onTime', 'Chance of meeting the deadline'],
];

interface Props {
  conv: Conversation;
  scope: ScopeResult;
  est: Estimate;
  spec: EstimateSpec;
  plan: Plan;
}

function Section({ id, idx, title, aside, children }: { id?: string; idx: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="est-section" data-hold={id ?? idx} aria-labelledby={`${idx}-title`}>
      <div className="est-head">
        <div className="flex flex-col gap-1">
          <Label idx={idx}>{title}</Label>
          <h3 id={`${idx}-title`} className="h-card m-0">
            {title}
          </h3>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function HeaderNumbers({ est, plan, scope }: { est: Estimate; plan: Plan; scope: ScopeResult }) {
  const sure = howSure(est.confidence);
  const open = est.rankedQuestions.length;
  const [why, setWhy] = useState(false);
  const openMethods = useMethods();
  const savedPct = plan.effortHWithoutTools > 0 ? Math.round(((plan.effortHWithoutTools - plan.effortH) / plan.effortHWithoutTools) * 100) : 0;
  const groups = useMemo(() => toWhy(est, scope, observedBias(), { tools: plan.tools, savedPct }), [est, scope, plan.tools, savedPct]);
  const fewDays = plan.planDays < 5;
  const goToQuestions = () => {
    const el = document.getElementById('est-questions');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (el as HTMLElement | null)?.focus?.({ preventScroll: true });
  };
  return (
    <section className="est-section" data-hold="header" aria-label="Headline">
      <div className="flex flex-wrap items-stretch gap-x-8 gap-y-6 justify-between">
        <div className="flex items-stretch gap-6 sm:gap-8 flex-wrap">
          <div id="est-hours" className="flex flex-col gap-2">
            <Label>{copy.estimatedEffort}</Label>
            <p className="big-number m-0 enter">{plan.effortH.toLocaleString('en-US')}</p>
            <span className="mono text-[13px] ink-2">{copy.workingHoursUnit}</span>
          </div>
          <span className="vrule max-sm:hidden" aria-hidden="true" />
          <div id="est-duration" className="flex flex-col gap-2">
            <Label>{copy.workingTime}</Label>
            <p className="big-number m-0 enter" style={{ ['--i' as string]: 1 }}>
              {fewDays ? copy.fewDays : fmtNum(halfWeeks(plan.planDays))}
            </p>
            <span className="mono text-[13px] ink-2">{fewDays ? copy.daysUnit : copy.weeksUnit}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 items-start sm:items-end">
          <Label>{copy.confidence}</Label>
          <SureBars sure={sure} size="lg" />
          {est.confidence === 'Low' && open ? (
            <button className="chip" onClick={goToQuestions}>
              {copy.makeSurer}
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-6">
        <button className="link text-[15px] inline-flex items-center gap-1.5" aria-expanded={why} aria-controls="why-panel" onClick={() => setWhy((w) => !w)}>
          {copy.whyLink}
          <Icon name="down" size={14} style={{ transform: why ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} />
        </button>
        {why ? (
          <div id="why-panel" className="panel p-4 sm:p-5 mt-3 flex flex-col gap-5 enter">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h4 className="label label-ink m-0">{copy.whyHours(plan.effortH.toLocaleString('en-US'))}</h4>
                <ul className="m-0 pl-4 flex flex-col gap-1.5 text-[15px] leading-relaxed ink-2">
                  {groups.hours.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2">
                <h4 className="label label-ink m-0">{copy.whyConfidence(sure.label)}</h4>
                <ul className="m-0 pl-4 flex flex-col gap-1.5 text-[15px] leading-relaxed ink-2">
                  {groups.confidence.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
            {groups.surprises.length ? (
              <div className="flex flex-col gap-2">
                <h4 className="label label-ink m-0">{copy.surprises}</h4>
                <ul className="m-0 pl-4 flex flex-col gap-1.5 text-[15px] leading-relaxed ink-2">
                  {groups.surprises.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <button
                className="link text-[15px]"
                onClick={() =>
                  openMethods({
                    title: scope.title,
                    intro: 'Every number on the estimate, with the method, the formula and the inputs that produced it.',
                    entries: METHOD_KEYS.filter(([k]) => est.explanations[k]).map(([k, title]) => ({ title, explanation: est.explanations[k]! })),
                  })
                }
              >
                {copy.fullWorking}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function TeamSection({ conv, scope, spec, onDefaults }: { conv: Conversation; scope: ScopeResult; spec: EstimateSpec; onDefaults: () => void }) {
  const { applySpec, readOnly } = useConversations();
  const needed = neededRoles(scope);
  const roles: Role[] = [...needed, ...ROLE_ORDER.filter((r) => !needed.includes(r))];
  const team = spec.team;
  const covered = spec.coveredRoles ?? {};
  const dropped = new Set(spec.droppedItemIds);
  const roleItems = (r: Role) => scope.items.filter((i) => i.role === r).map((i) => i.id);
  const skipped = (r: Role) => {
    const ids = roleItems(r);
    return ids.length > 0 && ids.every((id) => dropped.has(id));
  };
  const without = (r: Role) => {
    const rest = { ...covered };
    delete rest[r];
    return rest;
  };
  const setRole = (r: Role, v: number) => {
    if (v === (team[r] ?? 0)) return;
    applySpec(conv.id, { team: { ...team, [r]: v }, coveredRoles: v > 0 ? without(r) : covered }, copy.teamNote(rolePhrase(r, v)));
  };
  const coverFor = (r: Role): Role | undefined => {
    const candidates = (['engineer', ...needed, ...ROLE_ORDER] as Role[]).filter((c) => c !== r);
    return candidates.find((c) => (team[c] ?? 0) > 0);
  };
  const gaps = needed.filter((r) => (team[r] ?? 0) <= 0);
  return (
    <Section
      id="est-team"
      idx="§ 01"
      title={copy.teamTitle}
      aside={
        <button className="link text-[14px] shrink-0" onClick={onDefaults}>
          {copy.seeDefaultTeam}
        </button>
      }
    >
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))' }}>
        {roles.map((r) => {
          const v = team[r] ?? 0;
          const fraction = !Number.isInteger(v);
          const gap = needed.includes(r) && v <= 0 && !covered[r] && !skipped(r);
          return (
            <Stepper
              key={r}
              label={capitalise(roleWord(r, v === 1 ? 1 : 2))}
              tag={fraction ? <Tag tone="accent">{copy.partTime}</Tag> : undefined}
              value={v}
              min={0}
              max={9}
              step={0.5}
              decimals={2}
              warning={gap}
              disabled={readOnly}
              onChange={(n) => setRole(r, n)}
            />
          );
        })}
      </div>
      {gaps.map((r) => {
        const word = roleWord(r);
        const cover = coverFor(r);
        if (covered[r])
          return (
            <p key={r} className="m-0 mt-3 text-[14px] ink-2">
              {capitalise(copy.coveredBy(roleWord(covered[r] as Role)))}{' '}
              <button className="link" disabled={readOnly} onClick={() => applySpec(conv.id, { coveredRoles: without(r) }, copy.teamNote(rolePhrase(r, 0)))}>
                {copy.undo}
              </button>
            </p>
          );
        if (skipped(r))
          return (
            <p key={r} className="m-0 mt-3 text-[14px] ink-2">
              {capitalise(copy.skippedWork(word))}{' '}
              <button className="link" disabled={readOnly} onClick={() => applySpec(conv.id, { droppedItemIds: spec.droppedItemIds.filter((id) => !roleItems(r).includes(id)) }, copy.teamNote(rolePhrase(r, 0)))}>
                {copy.undo}
              </button>
            </p>
          );
        return (
          <div key={r} className="panel-warning p-4 mt-3 flex flex-col gap-3" role="group" aria-label={copy.noRole(word)}>
            <div className="flex items-start gap-2">
              <Icon name="warning" size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
              <div>
                <p className="m-0 font-semibold">{copy.noRole(word)}</p>
                <p className="m-0 text-[14px] ink-2">{copy.noRoleWhy(word)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {cover ? (
                <button className="btn btn-sm" disabled={readOnly} onClick={() => applySpec(conv.id, { coveredRoles: { ...covered, [r]: cover } }, copy.coverNote(roleWord(cover), word))}>
                  {copy.coverRole(capitalise(roleWord(cover)))}
                </button>
              ) : null}
              <button className="btn btn-sm" disabled={readOnly} onClick={() => applySpec(conv.id, { droppedItemIds: [...new Set([...spec.droppedItemIds, ...roleItems(r)])] }, copy.skipNote(word))}>
                {copy.skipRole(word)}
              </button>
              <button className="btn btn-primary btn-sm" disabled={readOnly} onClick={() => setRole(r, 1)}>
                {copy.addRole(word)}
              </button>
            </div>
          </div>
        );
      })}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------

function ToolsSection({ conv, plan, onDefaults }: { conv: Conversation; plan: Plan; onDefaults: () => void }) {
  const { applySpec, readOnly } = useConversations();
  const tools = plan.tools;
  const set = (kind: AiToolKind, p: AiPlan) => {
    const next: AiTools = { ...tools, [kind]: p };
    if (p === 'none') delete next[kind];
    applySpec(conv.id, { aiTools: next }, copy.toolsNote(copy.toolKinds[kind].name, copy.planPhrase[p]));
  };
  const saved = plan.effortHWithoutTools - plan.effortH;
  const pct = plan.effortHWithoutTools > 0 ? Math.round((saved / plan.effortHWithoutTools) * 100) : 0;
  const areas = [...new Set(AI_TOOL_KINDS.filter((k) => (tools[k] ?? 'none') !== 'none').map((k) => copy.toolKinds[k].area))];
  const areaText = areas.length <= 1 ? (areas[0] ?? '') : `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}`;
  return (
    <Section
      id="est-tools"
      idx="§ 02"
      title={copy.toolsTitle}
      aside={
        <button className="link text-[14px] shrink-0" onClick={onDefaults}>
          {copy.seeDefaultTools}
        </button>
      }
    >
      <p className="m-0 mb-1 text-[15px] ink-2">{copy.toolsQuestion}</p>
      <div className="flex flex-col divide-y" style={{ borderColor: 'var(--line)' }}>
        {AI_TOOL_KINDS.map((k) => (
          <PlanPicker key={k} kind={k} value={tools[k] ?? 'none'} disabled={readOnly} onChange={(p) => set(k, p)} />
        ))}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-3">
        <p className="m-0 text-[14px] muted" data-tools-note>
          {!hasTools(tools) ? copy.toolsNone : saved >= 5 ? copy.toolsSaves(saved, pct, areaText) : copy.toolsSavesLittle}
        </p>
        {plan.toolsSource === 'estimate' ? (
          <button className="link text-[13px]" disabled={readOnly} onClick={() => applySpec(conv.id, { aiTools: undefined }, copy.toolsResetNote)}>
            {copy.resetDefault}
          </button>
        ) : null}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------

function HoursSection({ conv, plan, onDefaults }: { conv: Conversation; plan: Plan; onDefaults: () => void }) {
  const { applySpec, readOnly } = useConversations();
  const { hpd, dpw } = plan.policy;
  const set = (d: number, h: number) => {
    if (d === dpw && h === hpd) return;
    applySpec(conv.id, { daysPerWeek: d, hoursPerDay: h }, copy.hoursNote(d, fmtNum(h)));
  };
  return (
    <Section
      idx="§ 03"
      title={copy.hoursTitle}
      aside={
        <button className="link text-[14px] shrink-0" onClick={onDefaults}>
          {copy.seeDefaultHours}
        </button>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid grid-cols-2 gap-3 w-full max-w-[20rem]">
          <Stepper label={copy.daysWeek} value={dpw} min={1} max={7} step={1} decimals={0} disabled={readOnly} onChange={(d) => set(d, hpd)} />
          <Stepper label={copy.hoursDay} value={hpd} min={1} max={12} step={0.5} decimals={1} disabled={readOnly} onChange={(h) => set(dpw, h)} />
        </div>
        {plan.policy.source === 'estimate' ? (
          <button className="link text-[13px] pb-2.5" disabled={readOnly} onClick={() => applySpec(conv.id, { hoursPerDay: undefined, daysPerWeek: undefined }, copy.hoursResetNote)}>
            {copy.resetDefault}
          </button>
        ) : null}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------

type Group = 'opp' | 'risk';

function PickChip({ s, on, tone, onToggle, disabled }: { s: Suggestion; on: boolean; tone: Group; onToggle: () => void; disabled?: boolean }) {
  const style = { ['--tone' as string]: tone === 'opp' ? 'var(--success)' : 'var(--danger)', ['--tone-soft' as string]: tone === 'opp' ? 'var(--success-soft)' : 'var(--danger-soft)' };
  return (
    <button type="button" className="chip-pick" aria-pressed={on} disabled={disabled} title={s.why} style={style} onClick={onToggle}>
      <Icon name="check" size={14} className="chip-tick" />
      {s.why ? <span className="chip-dot" aria-hidden="true" /> : null}
      <span className="min-w-0">{s.label}</span>
      <span className="chip-h">{signedHours(s.h)}</span>
      {s.why ? <span className="sr-only">({copy.seenBefore})</span> : null}
    </button>
  );
}

/** Tap-to-pick opportunities and risks, a margin for the unknown, and one live net line. */
function AdjustPanel({ conv, scope, spec, plan, onClose }: { conv: Conversation; scope: ScopeResult; spec: EstimateSpec; plan: Plan; onClose: () => void }) {
  const { applySpec } = useConversations();
  const hoursPerWeek = plan.policy.hpd * plan.policy.dpw;
  const opps = useMemo(() => suggestedOpportunities(scope, plan.effortHWithoutTools || plan.effortH), [scope, plan.effortHWithoutTools, plan.effortH]);
  const risksList = useMemo(() => suggestedRisks(scope, plan.effortHWithoutTools || plan.effortH, hoursPerWeek), [scope, plan.effortHWithoutTools, plan.effortH, hoursPerWeek]);
  const [picked, setPicked] = useState<BufferRisk[]>(spec.risks ?? []);
  const [pct, setPct] = useState<number>(spec.bufferPct ?? 0);
  const [other, setOther] = useState<Group | null>(null);
  const [otherLabel, setOtherLabel] = useState('');
  const [otherH, setOtherH] = useState('');
  const ids = pickedFrom(picked);
  const toggle = (s: Suggestion) => setPicked((ps) => (ids.has(s.id) ? ps.filter((r) => r.id !== s.id) : [...ps, { id: s.id, label: s.label, h: s.h }]));
  const addOther = () => {
    const h = Math.abs(Number(otherH.replace(',', '.')) || 0);
    if (!otherLabel.trim() || h <= 0 || !other) return;
    setPicked((ps) => [...ps, { id: `custom-${Date.now().toString(36)}`, label: otherLabel.trim(), h: other === 'opp' ? -h : h }]);
    setOtherLabel('');
    setOtherH('');
    setOther(null);
  };
  const saved = picked.filter((r) => r.h < 0).reduce((s, r) => s + r.h, 0);
  const added = picked.filter((r) => r.h > 0).reduce((s, r) => s + r.h, 0) + (plan.effortH * pct) / 100;
  const net = bufferExtraHours(plan.effortH, picked, pct);
  const customOf = (g: Group) => picked.filter((r) => r.id?.startsWith('custom-') && (g === 'opp' ? r.h < 0 : r.h > 0));

  const group = (g: Group, title: string, sub: string, list: Suggestion[]) => (
    <div className="adjust-group" style={{ ['--tone' as string]: g === 'opp' ? 'var(--success)' : 'var(--danger)' }} role="group" aria-label={title}>
      <div className="flex flex-col gap-0.5">
        <span className="label">{title}</span>
        <span className="text-[13px] muted">{sub}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {list.map((s) => (
          <PickChip key={s.id} s={s} on={ids.has(s.id)} tone={g} onToggle={() => toggle(s)} />
        ))}
        {customOf(g).map((r) => (
          <PickChip key={r.id} s={{ id: r.id as string, label: r.label, h: r.h }} on tone={g} onToggle={() => setPicked((ps) => ps.filter((x) => x.id !== r.id))} />
        ))}
        <button type="button" className="chip-pick" aria-expanded={other === g} onClick={() => setOther((o) => (o === g ? null : g))}>
          {copy.otherTag}
        </button>
      </div>
      {other === g ? (
        <div className="grid grid-cols-[minmax(0,1fr)_5rem_auto] gap-2 items-center">
          <label className="sr-only" htmlFor={`other-l-${g}`}>
            {copy.otherLabel}
          </label>
          <input id={`other-l-${g}`} className="input" placeholder={copy.otherLabel} value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOther())} autoFocus />
          <label className="sr-only" htmlFor={`other-h-${g}`}>
            {copy.otherHours}
          </label>
          <input id={`other-h-${g}`} className="input mono" inputMode="numeric" placeholder="h" value={otherH} onChange={(e) => setOtherH(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOther())} />
          <button type="button" className="btn btn-sm" onClick={addOther}>
            {copy.otherAdd}
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="panel p-4 sm:p-5 mt-3 flex flex-col gap-6 enter" role="group" aria-label={copy.adjustOpen}>
      {group('opp', copy.oppTitle, copy.oppSub, opps)}
      {group('risk', copy.riskGroupTitle, copy.riskSub, risksList)}
      <hr className="adjust-divider" />
      <fieldset className="m-0 p-0 border-0 adjust-group">
        <legend className="flex flex-col gap-0.5 mb-2">
          <span className="label label-ink">{copy.marginTitle}</span>
          <span className="text-[13px] muted">{copy.marginSub}</span>
        </legend>
        <div className="tabs tabs-fill" role="radiogroup" aria-label={copy.marginTitle}>
          {[0, 10, 15, 20, 30].map((p) => (
            <button key={p} type="button" role="radio" aria-checked={pct === p} aria-selected={pct === p} onClick={() => setPct(p)}>
              {p === 0 ? copy.bufferNone : `${p}%`}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rule-top pt-4" data-net>
        {saved < 0 ? (
          <span className="net-figure" style={{ color: 'var(--success)' }}>
            {signedHours(saved)} {copy.savedWord}
          </span>
        ) : null}
        {added > 0 ? (
          <span className="net-figure" style={{ color: 'var(--danger)' }}>
            {signedHours(added)} {copy.addedWord}
          </span>
        ) : null}
        <span className="mono text-[14px] font-semibold">{saved === 0 && added === 0 ? copy.netNothing : copy.netLine(signedHours(net), plan.effortH + net)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            applySpec(conv.id, { risks: picked.length ? picked : undefined, bufferPct: pct || undefined }, copy.adjustNote(net));
            onClose();
          }}
        >
          {copy.applyTimeline}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}

function ScheduleSection({ conv, scope, spec, plan }: Props) {
  const { applySpec, readOnly } = useConversations();
  const pms = usePostmortems();
  const [flagsAll, setFlagsAll] = useStore<Record<string, Partial<ForecastFlags>>>(FORECAST_KEY, {});
  const flags: ForecastFlags = { leave: true, hist: true, buf: true, ...flagsAll[conv.id] };
  const [included, setIncluded] = useState(false);
  const [risks, setRisks] = useState(false);
  const stats = squadStatsOf(conv);
  const adjustments = useMemo(() => {
    const out: Adjustment[] = [];
    const leave = leaveAdjustment(squadOf(conv)?.plannedLeave ?? [], spec.team, spec.startDate, plan.planDays);
    if (leave) out.push(leave);
    const hist = historyAdjustment(pms && { ...pms, results: allPostmortems(pms) }, historyFor().projects, scope.projectType, CY * stats.focusFactor);
    if (hist) out.push(hist);
    const buf = bufferAdjustment(plan.planDays, plan.f, spec.risks, spec.bufferPct);
    if (buf) out.push(buf);
    return out;
  }, [conv, spec, plan, pms, scope.projectType, stats.focusFactor]);
  const fc = toForecast(spec.startDate, plan.planDays, adjustments, flags);
  const meets = meetsDue(fc.realFinish, spec.deadline);
  const extraH = bufferExtraHours(plan.effortH, spec.risks, spec.bufferPct);
  const fromBrief = !!spec.deadline && spec.deadline === conv.clientDeadline;
  return (
    <Section idx="§ 04" title={copy.scheduleTitle}>
      <div className="grid gap-3 sm:grid-cols-3">
        <DateField label={copy.startDate} value={spec.startDate} disabled={readOnly} onChange={(d) => applySpec(conv.id, { startDate: d }, copy.startNote(formatDate(d)))} />
        <DateField label={copy.endDatePlan} value={fc.planFinish} disabled />
        <DateField label={copy.dueDate} hint={fromBrief ? copy.fromBrief : undefined} value={spec.deadline} disabled={readOnly} onChange={(d) => applySpec(conv.id, { deadline: d }, copy.dueNote(formatDate(d)))} />
      </div>

      <div className="panel-accent p-4 sm:p-5 mt-4 flex flex-col gap-3" data-hold="forecast">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Label ink>{copy.realistic}</Label>
            <p className="mid-number m-0">{copy.realisticLine(sd(fc.realDays), formatDate(fc.realFinish))}</p>
          </div>
          {meets === undefined ? null : <Tag tone={meets ? 'success' : 'danger'}>{meets ? copy.meetsDue : copy.missesDue}</Tag>}
        </div>
        {adjustments.length ? (
          <>
            <button className="link text-[14px] self-start inline-flex items-center gap-1.5" aria-expanded={included} onClick={() => setIncluded((v) => !v)}>
              {copy.whatsIncluded(fc.extraDays)}
              <Icon name="down" size={13} style={{ transform: included ? 'rotate(180deg)' : undefined }} />
            </button>
            {included ? (
              <ul className="list-none m-0 p-0 flex flex-col enter">
                {adjustments.map((a) => (
                  <li key={a.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-start py-2.5 rule-top">
                    <input
                      type="checkbox"
                      className="checkbox mt-1"
                      id={`adj-${a.id}`}
                      checked={flags[a.id]}
                      onChange={(e) => setFlagsAll({ ...flagsAll, [conv.id]: { ...flags, [a.id]: e.target.checked } })}
                    />
                    <label htmlFor={`adj-${a.id}`} className="min-w-0 cursor-pointer">
                      <span className="block font-semibold leading-snug">{a.title}</span>
                      <span className="block text-[13px] muted">{a.source}</span>
                    </label>
                    <span className="mono text-[14px] font-semibold whitespace-nowrap" style={{ opacity: flags[a.id] ? 1 : 0.45 }}>
                      {copy.plusDays(a.days)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="m-0 text-[14px] ink-2">{copy.nothingAdds}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-sm" disabled={readOnly} aria-expanded={risks} onClick={() => setRisks((v) => !v)}>
            {extraH !== 0 ? copy.adjustSet(signedHours(extraH)) : copy.adjustOpen}
          </button>
          {extraH !== 0 ? <Tag tone={extraH < 0 ? 'success' : 'danger'}>{extraH < 0 ? copy.savedWord : copy.addedWord}</Tag> : null}
        </div>
        {risks ? <AdjustPanel conv={conv} scope={scope} spec={spec} plan={plan} onClose={() => setRisks(false)} /> : null}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------

/** The estimate card (3.1): header numbers, why, team structure, AI tooling, working hours, schedule with the realistic forecast. */
export function EstimateCard(props: Props) {
  const { conv, scope, est, spec, plan } = props;
  const [modal, setModal] = useState<'team' | 'tools' | 'hours' | null>(null);
  return (
    <Card id="est-summary" as="article" inner="p-5 sm:p-7" aria-label="The estimate">
      <HeaderNumbers est={est} plan={plan} scope={scope} />
      <TeamSection conv={conv} scope={scope} spec={spec} onDefaults={() => setModal('team')} />
      <ToolsSection conv={conv} plan={plan} onDefaults={() => setModal('tools')} />
      <HoursSection conv={conv} plan={plan} onDefaults={() => setModal('hours')} />
      <ScheduleSection {...props} />
      {modal === 'team' ? <DefaultTeamModal scope={scope} onClose={() => setModal(null)} /> : null}
      {modal === 'tools' ? <DefaultToolsModal onClose={() => setModal(null)} /> : null}
      {modal === 'hours' ? <DefaultHoursModal stats={squadOf(conv)?.stats} onClose={() => setModal(null)} /> : null}
    </Card>
  );
}
