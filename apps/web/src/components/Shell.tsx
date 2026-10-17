import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { Conversation } from '@scopewise/shared';
import { copy } from '../copy';
import { formatWeeks } from '../present/format';
import { sidebarLine } from '../present/project';
import { sortedConversations, useConversations } from '../state/conversations';
import { useHistory } from '../state/history';
import { readStore } from '../lib/storage';
import { Icon, Mark, Spinner } from './ui';

type Theme = 'system' | 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readStore<Theme>('sw-theme', 'system'));
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') delete el.dataset.theme;
    else el.dataset.theme = theme;
    try {
      if (theme === 'system') window.localStorage.removeItem('sw-theme');
      else window.localStorage.setItem('sw-theme', JSON.stringify(theme));
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'))];
}

function when(iso: string): string {
  const d = iso.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (d === today) return 'today';
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function convLine(c: Conversation): string {
  const v = c.versions[c.currentEstimateId];
  if (c.status === 'working') return 'Working on it…';
  if (!v) return c.status === 'error' ? 'Needs another try' : '';
  return `${formatWeeks(v.summary.weeksLow, v.summary.weeksHigh)} · ${when(c.updatedAt)}`;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { conversations, mode } = useConversations();
  const history = useHistory();
  const [showAll, setShowAll] = useState(false);
  const [theme, cycleTheme] = useTheme();
  const navigate = useNavigate();
  const finished = history ? [...history.finished].reverse() : [];
  const shown = showAll ? finished : finished.slice(0, 6);
  return (
    <div className="bezel h-full bezel-flat">
      <div className="bezel-core sidebar-inner">
        <NavLink to="/" className="flex items-center gap-2.5 no-underline px-1" onClick={onNavigate} aria-label={`${copy.product}, ${copy.newEstimate}`}>
          <Mark />
          <span className="font-semibold tracking-tight text-[17px]" style={{ color: 'var(--ink)' }}>
            {copy.product}
          </span>
        </NavLink>
        <button
          className="btn btn-primary w-full justify-between"
          onClick={() => {
            navigate('/');
            onNavigate?.();
          }}
        >
          {copy.newEstimate}
          <span className="btn-icon">
            <Icon name="plus" size={16} />
          </span>
        </button>

        <nav aria-label={copy.recent} className="flex flex-col">
          <h2 className="side-label">{copy.recent}</h2>
          <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
            {sortedConversations(conversations).map((c) => (
              <li key={c.id}>
                <NavLink to={`/estimate/${c.id}`} className="side-item" onClick={onNavigate}>
                  <span className="block text-[15px] font-medium leading-snug truncate">{c.title}</span>
                  <span className="block text-[13px] muted">{convLine(c)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label={copy.finished} className="flex flex-col">
          <h2 className="side-label">{copy.finished}</h2>
          {!history ? (
            <div className="px-3 py-2">
              <Spinner label="Loading" />
            </div>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {shown.map((f) => {
                const line = sidebarLine(f.outcome);
                return (
                  <li key={f.project.id}>
                    <NavLink to={`/project/${f.project.id}`} className="side-item" onClick={onNavigate}>
                      <span className="block text-[15px] font-medium leading-snug truncate">{capitalise(f.project.name.split(': ')[1] ?? f.project.name)}</span>
                      <span className="block text-[13px]" style={{ color: line.tone === 'success' ? 'var(--success)' : 'var(--warning)' }}>
                        {line.text}
                      </span>
                    </NavLink>
                  </li>
                );
              })}
              {finished.length > 6 ? (
                <li>
                  <button className="link text-[13px] px-3 py-1" onClick={() => setShowAll((s) => !s)}>
                    {showAll ? copy.showFewer : copy.showAll(finished.length)}
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pt-2">
          <NavLink to="/about" className="side-item text-[15px]" onClick={onNavigate}>
            <span className="flex items-center gap-2">
              <Icon name="book" />
              {copy.howWorkedOut}
            </span>
          </NavLink>
          <div className="flex items-center justify-between gap-2 px-1">
            {mode.kind === 'live' ? <span className="tag tag-accent">Live</span> : mode.kind === 'demo' ? <span className="tag" title={mode.reason}>{copy.sampleData}</span> : <span />}
            <button className="btn btn-ghost btn-sm" onClick={cycleTheme} aria-label={`Theme: ${theme}. Change theme`}>
              {theme === 'system' ? 'Auto theme' : theme === 'light' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="History">
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>
      {open ? <div className="scrim" style={{ zIndex: 35 }} onClick={() => setOpen(false)} aria-hidden="true" /> : null}
      <div className="main">
        <div className="topbar">
          <button className="btn btn-sm" onClick={() => setOpen(true)} aria-label={copy.menu} aria-expanded={open}>
            <Icon name="menu" />
          </button>
          <Mark size={24} />
          <span className="font-semibold">{copy.product}</span>
        </div>
        <main id="main" tabIndex={-1} className="flex-1 flex flex-col min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}
