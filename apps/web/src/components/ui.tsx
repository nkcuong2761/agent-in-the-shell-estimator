import type { ReactNode, SVGProps } from 'react';
import type { Provenance } from '@scopewise/shared';
import type { SureLevel } from '../present/headline';

/** Line icons on a 20px grid, 1.75px strokes, drawn with currentColor. */
const PATHS = {
  plus: 'M10 4v12M4 10h12',
  minus: 'M4 10h12',
  arrow: 'M5 10h10M10.5 5.5L15 10l-4.5 4.5',
  send: 'M10 16V4M5 9l5-5 5 5',
  clip: 'M14.5 9.5l-5 5a3 3 0 01-4.2-4.2l5.6-5.6a2 2 0 012.8 2.8L8.3 13a1 1 0 01-1.4-1.4L11.5 7',
  link: 'M8.5 11.5l3-3M7 9.5l-1.5 1.5a2.5 2.5 0 003.5 3.5L10.5 13M13 10.5l1.5-1.5A2.5 2.5 0 0011 5.5L9.5 7',
  menu: 'M3.5 6h13M3.5 10h13M3.5 14h13',
  close: 'M5 5l10 10M15 5L5 15',
  copy: 'M7.5 7.5V4.5h8v8h-3M4.5 7.5h8v8h-8z',
  share: 'M10 12.5V3.5M6.5 7L10 3.5 13.5 7M4.5 11v4.5h11V11',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  chevron: 'M7.5 4.5l5.5 5.5-5.5 5.5',
  down: 'M4.5 7.5l5.5 5.5 5.5-5.5',
  up: 'M4.5 12.5L10 7l5.5 5.5',
  file: 'M11 3.5H6a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V7.5l-4-4zM11 3.5v4h4',
  jira: 'M10 3l7 7-7 7-7-7 7-7zM10 7l3 3-3 3-3-3 3-3z',
  book: 'M4 4.5h5.5a1.5 1.5 0 011.5 1.5v10a1 1 0 00-1-1H4V4.5zM16 4.5h-5.5A1.5 1.5 0 009 6v10a1 1 0 011-1h6V4.5z',
  spark: 'M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2.5 2.5M12 12l2.5 2.5M5.5 14.5L8 12M12 8l2.5-2.5',
  home: 'M3.5 9.5L10 4l6.5 5.5V16h-4.5v-4h-4v4H3.5z',
  calendar: 'M4 6h12v10H4zM4 9.5h12M7 4v3M13 4v3',
  trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.75 10h6.5L14 6M8.5 9v4.5M11.5 9v4.5',
  edit: 'M4 16h3.5L16 7.5l-3.5-3.5L4 12.5V16zM10.5 6l3.5 3.5',
  download: 'M10 3.5v9M6 9l4 4 4-4M4 15.5h12',
  search: 'M9 4a5 5 0 110 10A5 5 0 019 4zM12.5 12.5L16.5 16.5',
  warning: 'M10 3.5l7 12.5H3L10 3.5zM10 8v3.5M10 13.5v.5',
  chat: 'M4 4.5h12v8.5h-7l-3.5 3v-3H4z',
  minimize: 'M5 12.5h10',
  external: 'M8 4.5H4.5v11h11V12M11.5 4.5h4v4M15.5 4.5L9 11',
  reset: 'M4.5 10a5.5 5.5 0 109.5-3.8M4.5 4.5v4h4',
  sun: 'M10 6.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
  moon: 'M15.5 12.5A6 6 0 017.5 4.5a6 6 0 108 8z',
  auto: 'M10 3.5a6.5 6.5 0 100 13V3.5z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The product mark: a framed square with three rising bars, the last in the accent. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" fill="var(--ink)" />
      <rect x="3" y="3" width="26" height="26" fill="var(--bg)" />
      <rect x="8" y="18" width="4" height="7" fill="var(--ink)" />
      <rect x="14" y="13" width="4" height="12" fill="var(--ink)" />
      <rect x="20" y="8" width="4" height="17" fill="var(--accent)" />
    </svg>
  );
}

/** Logotype: mark plus wordmark in the display face. */
export function Logotype({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <Mark size={size} />
      <span className="font-[var(--font-display)] font-extrabold tracking-tight" style={{ fontSize: size * 0.72, lineHeight: 1 }}>
        Scopewise
      </span>
    </span>
  );
}

/** The card: a raw-ruled brick with a hard shadow. */
export function Card({ children, className = '', inner = '', flat = false, quiet = false, as: As = 'section', ...rest }: { children: ReactNode; className?: string; inner?: string; flat?: boolean; quiet?: boolean; as?: 'section' | 'div' | 'article' | 'aside' } & Record<string, unknown>) {
  return (
    <As className={`brick ${flat ? 'brick-flat' : ''} ${quiet ? 'brick-quiet' : ''} ${className}`} {...rest}>
      <div className={inner}>{children}</div>
    </As>
  );
}

/** Mono section label with an index mark: "§ 01 — Team structure". */
export function Label({ idx, children, className = '', ink = false }: { idx?: string; children: ReactNode; className?: string; ink?: boolean }) {
  return (
    <span className={`label ${ink ? 'label-ink' : ''} ${className}`}>
      {idx ? (
        <span className="idx" aria-hidden="true">
          {idx}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function Tag({ tone = 'default', children, className = '', title }: { tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent' | 'fill' | 'muted'; children: ReactNode; className?: string; title?: string }) {
  const cls = tone === 'default' ? '' : `tag-${tone}`;
  return (
    <span className={`tag ${cls} ${className}`} title={title}>
      {children}
    </span>
  );
}

export function SureBars({ sure, size = 'md' }: { sure: SureLevel; size?: 'md' | 'lg' }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="sure" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= sure.bars ? 'on' : ''} />
        ))}
      </span>
      <span className={size === 'lg' ? 'font-[var(--font-display)] font-extrabold text-[1.35rem] tracking-tight' : 'font-semibold'}>{sure.label}</span>
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm muted" role="status">
      <span className="spin" aria-hidden="true" />
      {label}
    </span>
  );
}

const PROVENANCE: Record<Provenance['generatedBy'], string> = {
  claude: 'read by Claude',
  fixture: 'a prepared example',
  'offline-heuristic': 'prepared offline',
};

export function provenanceWords(p: Provenance | undefined): string {
  return p ? PROVENANCE[p.generatedBy] : '';
}
