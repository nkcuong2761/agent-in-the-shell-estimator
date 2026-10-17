import type { ReactNode, SVGProps } from 'react';
import type { Provenance } from '@scopewise/shared';
import type { SureLevel } from '../present/headline';

/** Ultra-light line icons (1.5px strokes on a 20px grid), drawn with currentColor. */
const PATHS = {
  plus: 'M10 4.5v11M4.5 10h11',
  arrow: 'M6.5 13.5l7-7M8 6.5h5.5V12',
  send: 'M10 15.5V4.5M5.5 9L10 4.5 14.5 9',
  clip: 'M14.5 9.5l-5 5a3 3 0 01-4.2-4.2l5.6-5.6a2 2 0 012.8 2.8L8.3 13a1 1 0 01-1.4-1.4L11.5 7',
  link: 'M8.5 11.5l3-3M7 9.5l-1.5 1.5a2.5 2.5 0 003.5 3.5L10.5 13M13 10.5l1.5-1.5A2.5 2.5 0 0011 5.5L9.5 7',
  menu: 'M4 6.5h12M4 10h12M4 13.5h12',
  close: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  copy: 'M7.5 7.5V5a1 1 0 011-1H15a1 1 0 011 1v6.5a1 1 0 01-1 1h-2.5M5 7.5h6.5a1 1 0 011 1V15a1 1 0 01-1 1H5a1 1 0 01-1-1V8.5a1 1 0 011-1z',
  share: 'M10 12.5V4M6.5 7.5L10 4l3.5 3.5M5 11v4a1 1 0 001 1h8a1 1 0 001-1v-4',
  check: 'M5 10.5l3 3 7-7',
  chevron: 'M7.5 5l5 5-5 5',
  down: 'M5 7.5l5 5 5-5',
  file: 'M11 3.5H6.5a1 1 0 00-1 1v11a1 1 0 001 1h7a1 1 0 001-1V7l-3.5-3.5zM11 3.5V7h3.5',
  jira: 'M10 3.5l6.5 6.5-6.5 6.5L3.5 10 10 3.5zM10 7.5L12.5 10 10 12.5 7.5 10 10 7.5z',
  book: 'M4.5 5a1.5 1.5 0 011.5-1.5h9V15H6a1.5 1.5 0 00-1.5 1.5V5zM4.5 16.5A1.5 1.5 0 016 15h9v1.5',
  spark: 'M10 3.5v3M10 13.5v3M3.5 10h3M13.5 10h3M5.6 5.6l2 2M12.4 12.4l2 2M5.6 14.4l2-2M12.4 7.6l2-2',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The product mark: three rising bars, the last in the accent. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <rect x="8" y="17" width="4" height="7" rx="2" fill="var(--bg)" />
      <rect x="14" y="12" width="4" height="12" rx="2" fill="var(--bg)" />
      <rect x="20" y="8" width="4" height="16" rx="2" fill="var(--accent)" />
    </svg>
  );
}

/** Double-bezel card: an outer tray with an inner plate. */
export function Card({ children, className = '', inner = '', flat = false, as: As = 'section', ...rest }: { children: ReactNode; className?: string; inner?: string; flat?: boolean; as?: 'section' | 'div' | 'article' | 'aside' } & Record<string, unknown>) {
  return (
    <As className={`bezel ${flat ? 'bezel-flat' : ''} ${className}`} {...rest}>
      <div className={`bezel-core ${inner}`}>{children}</div>
    </As>
  );
}

export function SureBars({ sure }: { sure: SureLevel }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="sure" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= sure.bars ? 'on' : ''} />
        ))}
      </span>
      <span className="font-medium">{sure.label}</span>
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
