import type { ReactNode } from 'react';
import type { Provenance } from '@scopewise/shared';

export function Stepper({ value, onChange, min = 0, max = 12, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        -
      </button>
      <output aria-live="polite" aria-label={`${label}: ${value}`}>
        {value}
      </output>
      <button type="button" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

export function ConfidenceBadge({ level }: { level: 'High' | 'Medium' | 'Low' }) {
  const bars = level === 'High' ? '###' : level === 'Medium' ? '##.' : '#..';
  return (
    <span className={`badge badge-${level.toLowerCase()}`}>
      <span aria-hidden="true">{bars}</span>
      {level} confidence
    </span>
  );
}

const PROVENANCE_LABEL: Record<Provenance['generatedBy'], string> = {
  claude: 'Claude',
  fixture: 'Hand-written fixture',
  'offline-heuristic': 'Offline heuristic',
};

/** Says where an AI-shaped output came from, so nothing passes for Claude that wasn't. */
export function ProvenanceNote({ p, what }: { p: Provenance | undefined; what: string }) {
  if (!p) return null;
  return (
    <p className="mono text-[11px] muted m-0">
      {what}: {PROVENANCE_LABEL[p.generatedBy]}
      {p.model ? ` (${p.model})` : ''}, {p.promptVersion}
    </p>
  );
}

export function DisabledNote({ children }: { children: ReactNode }) {
  return <p className="text-sm muted m-0">{children}</p>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="box flex flex-col gap-3 items-start">
      <span className="box-c1" aria-hidden="true">
        +
      </span>
      <span className="box-c2" aria-hidden="true">
        +
      </span>
      <p className="h-sub m-0">{title}</p>
      {children ? <div className="muted measure">{children}</div> : null}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return (
    <span className="mono text-sm muted" role="status">
      {label}
      <span className="blink">_</span>
    </span>
  );
}
