import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useStore } from '../lib/store';
import { readStore, writeStore } from '../lib/storage';
import { Wordmark } from './Ascii';
import { AskPanel } from './AskPanel';

type Theme = 'system' | 'light' | 'dark';

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => readStore<Theme>('sw-theme', 'system'));
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') delete el.dataset.theme;
    else el.dataset.theme = theme;
    try {
      if (theme === 'system') window.localStorage.removeItem('sw-theme');
      else window.localStorage.setItem('sw-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, setTheme];
}

function ModeChip() {
  const { mode } = useStore();
  if (mode.kind === 'checking') return <span className="chip">Checking for an API…</span>;
  if (mode.kind === 'live')
    return (
      <span className="chip" title="Connected to the Scopewise API" style={{ borderColor: 'var(--blue)', color: 'var(--blue-ink)' }}>
        <span aria-hidden="true">(*)</span> Live mode
      </span>
    );
  return (
    <span className="chip" title={mode.reason}>
      <span aria-hidden="true">( )</span> Demo mode
    </span>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { activeId, workspaces, viewMode, setViewMode, askOpen, setAskOpen } = useStore();
  const [theme, setTheme] = useTheme();
  const loc = useLocation();
  const ws = workspaces[activeId];
  const flow = [
    { key: '1', to: '/', label: 'Intake', end: true },
    { key: '2', to: `/scope/${activeId}`, label: 'Scope' },
    { key: '3', to: `/estimate/${activeId}`, label: 'Estimate' },
    { key: '4', to: `/team/${activeId}`, label: 'Team & timeline' },
  ];
  const more = [
    { to: '/learning', label: 'Learning' },
    { to: '/about', label: 'About' },
  ];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setAskOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setAskOpen]);

  useEffect(() => {
    writeStore('sw-last', activeId);
  }, [activeId]);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="rail">
        <NavLink to="/" className="block no-underline" aria-label="Scopewise home">
          <Wordmark size={9.5} />
          <span className="text-xs muted block mt-2">Estimates that learn</span>
        </NavLink>
        <nav aria-label="Main" className="flex flex-col gap-0.5 max-[960px]:flex-row max-[960px]:flex-wrap max-[960px]:order-3 max-[960px]:w-full">
          {flow.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-item">
              <span className="nav-key" aria-hidden="true">
                {n.key}
              </span>
              {n.label}
            </NavLink>
          ))}
          <div className="h-3 max-[960px]:hidden" aria-hidden="true" />
          {more.map((n) => (
            <NavLink key={n.to} to={n.to} className="nav-item">
              <span className="nav-key" aria-hidden="true">
                &gt;
              </span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        {ws ? (
          <div className="text-sm max-[960px]:hidden">
            <p className="muted text-xs m-0">Working on</p>
            <p className="m-0 font-semibold leading-snug">{ws.title}</p>
            <p className="m-0 muted text-xs">{ws.client}</p>
          </div>
        ) : null}
        <div className="mt-auto flex flex-col gap-3 max-[960px]:mt-0 max-[960px]:flex-row max-[960px]:items-center max-[960px]:ml-auto">
          <ModeChip />
          <button className="btn btn-primary justify-center" onClick={() => setAskOpen(true)} aria-haspopup="dialog">
            Ask <span className="max-[960px]:hidden opacity-60">(press /)</span>
          </button>
          <div className="flex flex-col gap-1 max-[960px]:hidden">
            <label className="text-xs muted" htmlFor="view-mode">
              View
            </label>
            <select id="view-mode" className="input" value={viewMode} onChange={(e) => setViewMode(e.target.value as 'manager' | 'overseer')}>
              <option value="manager">Manager</option>
              <option value="overseer">Overseer (read only)</option>
            </select>
          </div>
          <button
            className="btn btn-sm justify-start max-[960px]:hidden"
            onClick={() => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')}
            aria-label={`Theme: ${theme}. Switch theme`}
          >
            Theme: {theme === 'system' ? 'auto' : theme}
          </button>
          <p className="text-[11px] muted m-0 max-[960px]:hidden">All clients, people and numbers here are fictional.</p>
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        <div className="page">{children}</div>
      </main>
      {askOpen ? <AskPanel onClose={() => setAskOpen(false)} /> : null}
    </div>
  );
}
