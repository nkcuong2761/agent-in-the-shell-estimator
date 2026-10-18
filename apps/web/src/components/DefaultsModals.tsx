import { useState } from 'react';
import type { Role, ScopeResult, SquadStats } from '@scopewise/shared';
import { capitalise, copy, roleWord } from '../copy';
import { categoryAdjective, categoryPlural } from '../lib/categories';
import { useStore } from '../lib/useStore';
import { fmtNum } from '../present/format';
import { ROLE_ORDER, neededRoles } from '../state/engine';
import { HOURS_DEF_KEY, TEAM_DEF_KEY, learnedPolicy, type HoursDefault, type TeamDefaults } from '../state/policy';
import { Modal, Stepper } from './fields';
import { Icon } from './ui';

function WarningBox({ children }: { children: string }) {
  return (
    <div className="panel-warning p-3 flex gap-3 items-start text-[14px] leading-snug" role="note">
      <Icon name="warning" size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
      <span>{children}</span>
    </div>
  );
}

/** Default team per project category: what new estimates in that category start from. */
export function DefaultTeamModal({ scope, onClose }: { scope: ScopeResult; onClose: () => void }) {
  const [defaults, setDefaults] = useStore<TeamDefaults>(TEAM_DEF_KEY, {});
  const category = scope.projectType;
  const saved = defaults[category];
  const needed = neededRoles(scope);
  const initial = (): Record<Role, number> => {
    const t = Object.fromEntries(ROLE_ORDER.map((r) => [r, needed.includes(r) ? 1 : 0])) as Record<Role, number>;
    if (saved) for (const [r, n] of Object.entries(saved) as [Role, number][]) t[r] = n;
    return t;
  };
  const [team, setTeam] = useState<Record<Role, number>>(initial);
  const adj = categoryAdjective(category);
  const save = () => {
    const next: Partial<Record<Role, number>> = {};
    for (const r of ROLE_ORDER) if (team[r] > 0) next[r] = team[r];
    setDefaults({ ...defaults, [category]: next });
    onClose();
  };
  const reset = () => {
    const rest = { ...defaults };
    delete rest[category];
    setDefaults(rest);
    onClose();
  };
  return (
    <Modal
      title={copy.defaultTeamTitle(categoryPlural(category))}
      intro={saved ? copy.defaultTeamIntroSaved(adj) : copy.defaultTeamIntro(adj)}
      onClose={onClose}
      footer={
        <>
          {saved ? (
            <button className="btn btn-ghost btn-sm mr-auto" onClick={reset}>
              <Icon name="reset" size={14} />
              {copy.resetPerRole}
            </button>
          ) : null}
          <button className="btn btn-sm" onClick={onClose}>
            {copy.cancel}
          </button>
          <button className="btn btn-primary btn-sm" onClick={save}>
            {copy.saveDefault}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {ROLE_ORDER.map((r) => (
          <Stepper key={r} label={capitalise(roleWord(r, team[r] === 1 ? 1 : 2))} value={team[r]} min={0} max={9} step={1} decimals={2} onChange={(v) => setTeam((t) => ({ ...t, [r]: v }))} />
        ))}
      </div>
      <WarningBox>{copy.defaultTeamWarning(adj)}</WarningBox>
      <p className="m-0 text-[13px] muted">{copy.defaultTeamHint}</p>
    </Modal>
  );
}

/** Default working hours (global): applies to estimates created after it is saved. */
export function DefaultHoursModal({ stats, onClose }: { stats: SquadStats | undefined; onClose: () => void }) {
  const [saved, setSaved] = useStore<HoursDefault | null>(HOURS_DEF_KEY, null);
  const learned = learnedPolicy(stats);
  const [dpw, setDpw] = useState(saved?.dpw ?? learned.dpw);
  const [hpd, setHpd] = useState(saved?.hpd ?? learned.hpd);
  const intro = saved
    ? copy.defaultHoursIntroSaved(saved.dpw, fmtNum(saved.hpd))
    : learned.source === 'learned'
      ? copy.defaultHoursIntro(learned.dpw, fmtNum(learned.hpd))
      : copy.defaultHoursIntroFallback(learned.dpw, fmtNum(learned.hpd));
  return (
    <Modal
      title={copy.defaultHoursTitle}
      intro={intro}
      onClose={onClose}
      footer={
        <>
          {saved ? (
            <button
              className="btn btn-ghost btn-sm mr-auto"
              onClick={() => {
                setSaved(undefined);
                onClose();
              }}
            >
              <Icon name="reset" size={14} />
              {copy.resetLearned}
            </button>
          ) : null}
          <button className="btn btn-sm" onClick={onClose}>
            {copy.cancel}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setSaved({ dpw, hpd, at: new Date().toISOString() });
              onClose();
            }}
          >
            {copy.saveDefault}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Stepper label={copy.daysWeek} value={dpw} min={1} max={7} step={1} decimals={0} onChange={setDpw} />
        <Stepper label={copy.hoursDay} value={hpd} min={1} max={12} step={0.5} decimals={1} onChange={setHpd} />
      </div>
      <WarningBox>{copy.defaultHoursWarning}</WarningBox>
      <p className="m-0 text-[13px] muted">{copy.defaultHoursHint}</p>
    </Modal>
  );
}
