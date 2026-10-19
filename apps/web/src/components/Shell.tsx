import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { Conversation } from '@scopewise/shared';
import { copy } from '../copy';
import { readStore } from '../lib/storage';
import { todayIso } from '../present/format';
import { progressLine } from '../present/progress';
import { sortedConversations, useConversations } from '../state/conversations';
import { planOf } from '../state/engine';
import { Icon, Logotype, Mark, type IconName } from './ui';

type Theme = 'dark' | 'light' | 'system';
const THEME_ICON: Record<Theme, IconName> = { dark: 'moon', light: 'sun', system: 'auto' };

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = readStore<string>('sw-theme', 'dark');
    return t === 'light' || t === 'system' ? t : 'dark';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('sw-theme', JSON.stringify(theme));
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : t === 'light' ? 'system' : 'dark'))];
}

function readSession(key: string, fallback: boolean): boolean {
  try {
    const v = window.sessionStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function OngoingRow({ c, onNavigate, today }: { c: Conversation; onNavigate?: () => void; today: string }) {
  const spec = c.versions[c.currentEstimateId]?.spec;
  const plan = c.status === 'ready' && spec ? planOf(c, spec) : undefined;
  const line = progressLine(c.status, spec?.startDate ?? c.startDate, plan?.planDays, today);
  const color = line.tone === 'warning' ? 'var(--warning)' : line.tone === 'ink' ? 'var(--ink-2)' : 'var(--muted)';
  return (
    <li>
      <NavLink to={`/estimate/${c.id}`} className="side-item" onClick={onNavigate}>
        <span className="block text-[14px] font-semibold leading-snug truncate">{c.title}</span>
        <span className="block text-[12px] mono leading-snug" style={{ color }}>
          {line.text}
        </span>
        {line.pct !== undefined ? (
          <span className="progress-bar block" aria-hidden="true">
            <span style={{ width: `${Math.round(line.pct * 100)}%`, background: line.tone === 'warning' ? 'var(--warning)' : 'var(--accent)' }} />
          </span>
        ) : null}
      </NavLink>
    </li>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { conversations } = useConversations();
  const [theme, cycleTheme] = useTheme();
  const [ongoingOpen, setOngoingOpen] = useState(() => readSession('sw-ongoing-open', true));
  const today = todayIso();
  const active = sortedConversations(conversations).filter((c) => c.status !== 'error');
  const toggleOngoing = () => {
    setOngoingOpen((o) => {
      try {
        window.sessionStorage.setItem('sw-ongoing-open', o ? '0' : '1');
      } catch {
        /* session storage unavailable */
      }
      return !o;
    });
  };
  return (
    <div className="sidebar-inner">
      <NavLink to="/" className="no-underline px-2 py-1 mb-3 inline-flex" onClick={onNavigate} aria-label={`${copy.product}, ${copy.home}`} style={{ color: 'var(--ink)' }}>
        <Logotype size={24} />
      </NavLink>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <NavLink to="/" end className="side-row" onClick={onNavigate}>
          <Icon name="home" size={18} />
          {copy.home}
        </NavLink>
        <NavLink to="/new" className="side-cta" onClick={onNavigate}>
          <Icon name="plus" size={18} />
          {copy.newEstimate}
        </NavLink>
      </nav>

      <section aria-label={copy.ongoing} className="mt-4 flex flex-col">
        <button className="side-head" aria-expanded={ongoingOpen} onClick={toggleOngoing}>
          <span className="label">{copy.ongoing}</span>
          <Icon name="down" size={14} className="muted" style={{ transform: ongoingOpen ? undefined : 'rotate(-90deg)', transition: 'transform 120ms' }} />
        </button>
        {ongoingOpen ? (
          active.length ? (
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {active.map((c) => (
                <OngoingRow key={c.id} c={c} onNavigate={onNavigate} today={today} />
              ))}
            </ul>
          ) : (
            <p className="m-0 px-2.5 py-1 text-[13px] muted">{copy.noEstimates}</p>
          )
        ) : null}
      </section>

      <div className="mt-auto pt-3 flex flex-col gap-0.5" style={{ borderTop: '1px solid var(--line)' }}>
        <NavLink to="/about" className="side-row" onClick={onNavigate}>
          <Icon name="book" size={18} />
          {copy.help}
        </NavLink>
        <button className="side-row" onClick={cycleTheme} aria-label={`${copy.theme[theme]}. Change theme`}>
          <Icon name={THEME_ICON[theme]} size={18} />
          {copy.theme[theme]}
        </button>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);
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
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Navigation">
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>
      {open ? <div className="scrim" style={{ zIndex: 35 }} onClick={() => setOpen(false)} aria-hidden="true" /> : null}
      <div className="main">
        <div className="topbar">
          <button className="btn btn-sm btn-icon-only" onClick={() => setOpen(true)} aria-label={copy.menu} aria-expanded={open}>
            <Icon name="menu" size={16} />
          </button>
          <Mark size={22} />
          <span className="font-[var(--font-display)] font-extrabold">{copy.product}</span>
        </div>
        <main id="main" tabIndex={-1} className="flex-1 flex flex-col min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}
