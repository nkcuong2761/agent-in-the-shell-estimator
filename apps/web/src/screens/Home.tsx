import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Conversation, ProjectType } from '@scopewise/shared';
import { Icon, Logotype, Tag } from '../components/ui';
import { copy } from '../copy';
import { categoryLabel } from '../lib/categories';
import { addWorkingDays } from '@scopewise/engine';
import { fmtNum, formatDate, formatLongDate, halfWeeks } from '../present/format';
import { useConversations } from '../state/conversations';
import { planOf, scopeOf } from '../state/engine';
import { useHistory, type FinishedProject } from '../state/history';
import { NewEstimate } from './NewEstimate';

type Tab = 'all' | 'open' | 'finished';

interface Row {
  key: string;
  kind: 'estimate' | 'finished';
  name: string;
  sub: string;
  category: string;
  status: { label: string; tone: 'success' | 'warning' | 'danger' | 'accent' | 'muted' };
  due: string;
  effort: string;
  plan: string;
  planTone?: 'success' | 'warning';
  href: string;
  updated: string;
  conv?: Conversation;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function estimateRow(c: Conversation): Row {
  const scope = scopeOf(c);
  const spec = c.versions[c.currentEstimateId]?.spec;
  const plan = c.status === 'ready' && spec ? planOf(c, spec) : undefined;
  const status = c.status === 'ready' ? { label: copy.statusEstimated, tone: 'accent' as const } : c.status === 'working' ? { label: copy.statusWorking, tone: 'muted' as const } : { label: copy.statusError, tone: 'danger' as const };
  return {
    key: c.id,
    kind: 'estimate',
    name: c.title,
    sub: copy.updatedOn(formatLongDate(c.updatedAt)),
    category: categoryLabel(scope?.projectType),
    status,
    due: spec?.deadline ? formatDate(spec.deadline) : '—',
    effort: plan ? `${plan.effortH.toLocaleString('en-US')} h · ${fmtNum(halfWeeks(plan.planDays))} weeks` : '—',
    plan: plan && spec ? copy.planOn(formatDate(addWorkingDays(spec.startDate, plan.planDays))) : '—',
    href: `/estimate/${c.id}`,
    updated: c.updatedAt,
    conv: c,
  };
}

function finishedRow(f: FinishedProject): Row {
  const [, name] = f.project.name.split(': ');
  const o = f.outcome;
  const late = o.tookWeeks - o.said.high;
  return {
    key: f.project.id,
    kind: 'finished',
    name: capitalise(name ?? f.project.name),
    sub: copy.projectFinished(formatLongDate(f.project.endDate)),
    category: categoryLabel(f.project.projectType),
    status: { label: copy.statusFinished, tone: 'success' },
    due: '—',
    effort: `${Math.round(f.project.estimateH).toLocaleString('en-US')} h · ${o.said.text}`,
    plan: o.onTime ? copy.onTimeResult(formatDate(f.project.endDate)) : copy.lateResult(`${late} week${late === 1 ? '' : 's'}`, formatDate(f.project.endDate)),
    planTone: o.onTime ? 'success' : 'warning',
    href: `/project/${f.project.id}`,
    updated: f.project.endDate,
  };
}

function csvOf(rows: Row[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = [copy.colName, copy.colCategory, copy.colStatus, copy.colDue, copy.colEffort, copy.colPlan];
  return [head, ...rows.map((r) => [r.name, r.category, r.status.label, r.due, r.effort, r.plan])].map((r) => r.map(esc).join(',')).join('\n');
}

function Tile({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div className="tile">
      <span className="label">{label}</span>
      <span className="mid-number">{value}</span>
      <span className="text-[13px] muted">{sub}</span>
    </div>
  );
}

function EstimateActions({ row }: { row: Row }) {
  const { rename, remove, readOnly } = useConversations();
  const [mode, setMode] = useState<'idle' | 'rename' | 'delete'>('idle');
  const [draft, setDraft] = useState(row.name);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (!row.conv) return null;
  if (mode === 'rename')
    return (
      <form
        className="flex gap-1.5 items-center"
        onClick={stop}
        onSubmit={(e) => {
          e.preventDefault();
          rename(row.conv!.id, draft);
          setMode('idle');
        }}
      >
        <label className="sr-only" htmlFor={`rn-${row.key}`}>
          {copy.rename}
        </label>
        <input id={`rn-${row.key}`} className="input !min-h-8 !py-1 text-[14px] w-40" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e: KeyboardEvent) => e.key === 'Escape' && setMode('idle')} />
        <button type="submit" className="btn btn-sm btn-icon-only" aria-label="Save name">
          <Icon name="check" size={14} />
        </button>
      </form>
    );
  if (mode === 'delete')
    return (
      <span className="flex gap-1.5 items-center text-[13px]" onClick={stop} role="group" aria-label={copy.confirmDelete}>
        <span className="muted">{copy.confirmDelete}</span>
        <button className="btn btn-sm btn-danger" onClick={() => remove(row.conv!.id)}>
          {copy.deleteWord}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setMode('idle')}>
          {copy.cancel}
        </button>
      </span>
    );
  return (
    <span className="flex gap-1 justify-end" onClick={stop}>
      <button className="btn btn-ghost btn-sm btn-icon-only" aria-label={`${copy.rename} ${row.name}`} disabled={readOnly} onClick={() => setMode('rename')}>
        <Icon name="edit" size={15} />
      </button>
      <button className="btn btn-ghost btn-sm btn-icon-only" aria-label={`${copy.deleteWord} ${row.name}`} disabled={readOnly} onClick={() => setMode('delete')}>
        <Icon name="trash" size={15} />
      </button>
    </span>
  );
}

/** Home for returning users: the Estimates table. With no estimates, the brief screen. */
export function Home() {
  const { conversations } = useConversations();
  const history = useHistory();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'open' ? 'open' : tabParam === 'finished' ? 'finished' : 'all';
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');

  const estimates = useMemo(() => [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(estimateRow), [conversations]);
  const finished = useMemo(() => (history ? [...history.finished].reverse().map(finishedRow) : []), [history]);
  if (!conversations.length) return <NewEstimate />;

  const all = [...estimates, ...finished];
  const categories = [...new Set(all.map((r) => r.category))].sort();
  const pool = tab === 'open' ? estimates : tab === 'finished' ? finished : all;
  const rows = pool.filter((r) => (cat === 'all' || r.category === cat) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())));
  const open = conversations.filter((c) => c.status !== 'error').length;
  const last = history ? history.finished.slice(-10) : [];
  const onTime = last.filter((f) => f.outcome.onTime).length;
  const setTab = (t: Tab) => setParams(t === 'all' ? {} : { tab: t }, { replace: true });
  const exportCsv = () => {
    const blob = new Blob([csvOf(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scopewise-estimates.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const openRow = (r: Row) => navigate(r.href);

  return (
    <div className="page page-wide">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="m-0" style={{ color: 'var(--ink)' }}>
            <Logotype size={52} />
          </h1>
          <p className="m-0 text-[17px] ink-2 measure">{copy.homeSub}</p>
        </div>
        <Link to="/new" className="btn btn-primary">
          {copy.newEstimate}
          <span className="btn-icon">
            <Icon name="plus" size={14} />
          </span>
        </Link>
      </header>

      <div className="grid sm:grid-cols-3">
        <Tile value={String(open)} label={copy.openEstimates} sub={copy.beingScoped} />
        <Tile value={history ? String(history.finished.length) : '…'} label={copy.finishedProjects} sub={copy.learnsFrom} />
        <Tile value={history ? `${onTime} of ${last.length}` : '…'} label={copy.deliveredOnTime} sub={copy.lastFinished} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="tabs" role="tablist" aria-label="Show">
          {(
            [
              ['all', copy.tabAll, all.length],
              ['open', copy.tabEstimates, estimates.length],
              ['finished', copy.tabFinished, finished.length],
            ] as [Tab, string, number][]
          ).map(([t, label, n]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {label} <span className="opacity-70">{n}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="sr-only">{copy.colCategory}</span>
          <select className="select text-[14px]" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">{copy.allCategories}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 relative">
          <span className="sr-only">{copy.searchPlaceholder}</span>
          <Icon name="search" size={15} className="absolute left-2.5 muted" />
          <input className="input text-[14px] pl-8 w-48" placeholder={copy.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="btn btn-sm ml-auto" onClick={exportCsv}>
          <Icon name="download" size={14} />
          {copy.exportCsv}
        </button>
      </div>

      <div className="brick brick-flat overflow-x-auto">
        <table className="table min-w-[52rem]">
          <thead>
            <tr>
              <th>{copy.colName}</th>
              <th>{copy.colCategory}</th>
              <th>{copy.colStatus}</th>
              <th>{copy.colDue}</th>
              <th>{copy.colEffort}</th>
              <th>{copy.colPlan}</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.kind}-${r.key}`}
                className="is-link"
                tabIndex={0}
                onClick={() => openRow(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) openRow(r);
                }}
                aria-label={`Open ${r.name}`}
              >
                <td>
                  <span className="block font-semibold leading-snug">{r.name}</span>
                  <span className="block text-[12px] muted mono">{r.sub}</span>
                </td>
                <td className="whitespace-nowrap">{r.category}</td>
                <td>
                  <Tag tone={r.status.tone}>{r.status.label}</Tag>
                </td>
                <td className="mono whitespace-nowrap">{r.due}</td>
                <td className="mono whitespace-nowrap">{r.effort}</td>
                <td className="mono whitespace-nowrap" style={{ color: r.planTone === 'success' ? 'var(--success)' : r.planTone === 'warning' ? 'var(--warning)' : undefined }}>
                  {r.plan}
                </td>
                <td className="text-right">{r.kind === 'estimate' ? <EstimateActions row={r} /> : null}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="muted text-center py-8">
                  {copy.noRows}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type { ProjectType };
