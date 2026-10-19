import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AiPlan, AiToolKind } from '@scopewise/shared';
import { copy } from '../copy';
import { fmtNum, formatDate, todayIso } from '../present/format';
import { AI_PLANS } from '../state/policy';
import { Icon } from './ui';

// ---------------------------------------------------------------------------------------------
// Stepper field: label above, one 40px box [ − | value | + ], typeable value with comma or dot.

export interface StepperProps {
  label: ReactNode;
  tag?: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Decimal places accepted when typing (0 = whole numbers, 2 = hundredths). */
  decimals?: number;
  onChange: (v: number) => void;
  warning?: boolean;
  disabled?: boolean;
  unit?: string;
  describedBy?: string;
}

function parseNumber(raw: string): number | undefined {
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function Stepper({ label, tag, value, min, max, step, decimals = 2, onChange, warning, disabled, unit, describedBy }: StepperProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 10 ** decimals) / 10 ** decimals));
  const commit = (raw: string) => {
    const n = parseNumber(raw);
    if (n !== undefined) onChange(clamp(n));
    setDraft(null);
  };
  const shown = draft ?? fmtNum(value, decimals);
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-[13px] muted flex items-center gap-2 flex-wrap leading-tight">
        <span>{label}</span>
        {tag}
      </label>
      <div className={`step ${warning ? 'is-warning' : ''} ${disabled ? 'is-disabled' : ''}`}>
        <button type="button" aria-label={`Decrease ${typeof label === 'string' ? label : ''}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))}>
          <Icon name="minus" size={16} />
        </button>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          aria-describedby={describedBy}
          aria-invalid={warning || undefined}
          value={shown}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setDraft(null);
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              onChange(clamp(value + step));
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              onChange(clamp(value - step));
            }
          }}
        />
        <button type="button" aria-label={`Increase ${typeof label === 'string' ? label : ''}`} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      {unit ? <span className="sr-only">{unit}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Date field: a button styled like an input that opens a small calendar popover.

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

function Calendar({ value, onPick, onClose }: { value: string | undefined; onPick: (d: string) => void; onClose: () => void }) {
  const today = todayIso();
  const base = value ?? today;
  const [y0, m0] = [Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1];
  const [view, setView] = useState({ y: y0, m: m0 });
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const daysIn = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const prevDays = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
  const cells: { d: string; other: boolean }[] = [];
  for (let i = lead - 1; i >= 0; i--) cells.push({ d: iso(view.y, view.m - 1, prevDays - i), other: true });
  for (let d = 1; d <= daysIn; d++) cells.push({ d: iso(view.y, view.m, d), other: false });
  while (cells.length % 7) cells.push({ d: iso(view.y, view.m + 1, cells.length - lead - daysIn + 1), other: true });
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Keep the popover inside the viewport (the floating assistant or the window edge could clip it).
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) el.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div ref={ref} className="calendar" role="dialog" aria-label="Choose a date">
      <div className="flex items-center justify-between mb-2">
        <button type="button" className="btn btn-ghost btn-sm btn-icon-only" aria-label="Previous month" onClick={() => setView((v) => ({ y: v.m === 0 ? v.y - 1 : v.y, m: (v.m + 11) % 12 }))}>
          <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <span className="mono text-[13px] font-semibold">
          {MONTHS[view.m]} {view.y}
        </span>
        <button type="button" className="btn btn-ghost btn-sm btn-icon-only" aria-label="Next month" onClick={() => setView((v) => ({ y: v.m === 11 ? v.y + 1 : v.y, m: (v.m + 1) % 12 }))}>
          <Icon name="chevron" size={14} />
        </button>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => (
          <span key={d} className="cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {cells.map(({ d, other }) => {
          const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
          const weekend = dow === 0 || dow === 6;
          return (
            <button
              key={d}
              type="button"
              className={`cal-day ${other ? 'is-other' : ''} ${weekend ? 'is-weekend' : ''} ${d === today ? 'is-today' : ''} ${d === value ? 'is-selected' : ''}`}
              aria-label={formatDate(d)}
              aria-pressed={d === value}
              onClick={() => onPick(d)}
            >
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-2">
        <button type="button" className="link text-[13px]" onClick={() => onPick(today)}>
          Today
        </button>
        <button type="button" className="link text-[13px]" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function DateField({ label, hint, value, onChange, disabled, placeholder = 'Pick a date' }: { label: ReactNode; hint?: ReactNode; value: string | undefined; onChange?: (d: string) => void; disabled?: boolean; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  return (
    <div ref={wrap} className="relative flex flex-col gap-1.5 min-w-0">
      <span className="text-[13px] muted leading-tight" id={id}>
        {label}
        {hint ? <span className="muted"> {hint}</span> : null}
      </span>
      <button type="button" className="datefield" aria-labelledby={id} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <span className={value ? '' : 'muted font-normal'}>{value ? formatDate(value) : placeholder}</span>
        <Icon name="calendar" size={16} className={disabled ? 'muted' : ''} />
      </button>
      {open && !disabled ? (
        <Calendar
          value={value}
          onPick={(d) => {
            onChange?.(d);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Modal: centred, portalled to body, body scroll locked, Escape / × / backdrop close.

export function Modal({ title, intro, onClose, children, footer, labelledBy }: { title: ReactNode; intro?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; labelledBy?: string }) {
  const id = useId();
  const titleId = labelledBy ?? id;
  const closeRef = useRef<HTMLButtonElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    prev.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      (prev.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <>
      <div className="scrim" style={{ zIndex: 94 }} onClick={onClose} aria-hidden="true" />
      <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="modal-head">
            <div className="flex flex-col gap-1.5 min-w-0">
              <h2 id={titleId} className="h-card m-0">
                {title}
              </h2>
              {intro ? <p className="m-0 text-[15px] ink-2 leading-snug">{intro}</p> : null}
            </div>
            <button ref={closeRef} type="button" className="btn btn-ghost btn-sm btn-icon-only shrink-0" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer ? <div className="modal-foot">{footer}</div> : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Plan picker for one kind of tool: None | Free | Paid | Enterprise as a radio group. */
export function PlanPicker({ kind, value, disabled, onChange }: { kind: AiToolKind; value: AiPlan; disabled?: boolean; onChange: (p: AiPlan) => void }) {
  const info = copy.toolKinds[kind];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 tool-row">
      <div className="flex flex-col min-w-0">
        <span className="text-[15px]">{info.name}</span>
        <span className="text-[13px] muted">{info.examples}</span>
      </div>
      <div className="seg" role="radiogroup" aria-label={info.name}>
        {AI_PLANS.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={value === p} className={value === p ? 'is-on' : ''} disabled={disabled} onClick={() => value !== p && onChange(p)}>
            {copy.planWords[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
