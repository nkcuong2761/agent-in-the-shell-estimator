import type { ReactNode } from 'react';

/** "scopewise" in a small figlet-style face, pure 7-bit ASCII. */
const WORDMARK = String.raw`                             _
 ___ __ ___ _ __  _____ __ _(_)___ ___
(_-</ _/ _ \ '_ \/ -_) V  V / (_-</ -_)
/__/\__\___/ .__/\___|\_/\_/|_/__/\___|
           |_|`;

export function Wordmark({ size = 7 }: { size?: number }) {
  return (
    <pre aria-label="Scopewise" role="img" className="m-0 select-none leading-[1.05]" style={{ fontFamily: 'var(--font-mono)', fontSize: size, fontWeight: 600, fontStretch: '75%', letterSpacing: 0, color: 'var(--ink)' }}>
      {WORDMARK}
    </pre>
  );
}

/** An ASCII-framed region: a rule with + corners and an optional title set into the top edge. */
export function Box({
  title,
  children,
  className = '',
  well = false,
  as: As = 'section',
  labelledBy,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  well?: boolean;
  as?: 'section' | 'div' | 'aside' | 'article';
  labelledBy?: string;
}) {
  return (
    <As className={`box ${well ? 'box-well' : ''} ${className}`} aria-labelledby={labelledBy}>
      <span className="box-c1" aria-hidden="true">
        +
      </span>
      <span className="box-c2" aria-hidden="true">
        +
      </span>
      {title ? (
        <h2 className="box-title" id={labelledBy}>
          {title}
        </h2>
      ) : null}
      {children}
    </As>
  );
}

export function Rule({ className = '' }: { className?: string }) {
  return <div className={`ascii-rule ${className}`} aria-hidden="true" />;
}

/** A row of characters as a text "bar": ####==== */
export function TextBar({ value, max, width = 24, full = '#', part = '=', empty = '.' }: { value: number; max: number; width?: number; full?: string; part?: string; empty?: string }) {
  const n = Math.max(0, Math.min(width, Math.round((value / Math.max(max, 1e-9)) * width)));
  return (
    <span className="mono" aria-hidden="true">
      {full.repeat(Math.max(0, n - 1))}
      {n > 0 ? part : ''}
      <span className="muted">{empty.repeat(width - n)}</span>
    </span>
  );
}
