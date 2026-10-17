import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Explanation } from '@scopewise/shared';

interface Open {
  title: string;
  explanation: Explanation;
}

const Ctx = createContext<{ open: (o: Open) => void } | null>(null);

export function ExplainProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Open | null>(null);
  const open = useCallback((o: Open) => setCurrent(o), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {current ? <ExplainDrawer {...current} onClose={() => setCurrent(null)} /> : null}
    </Ctx.Provider>
  );
}

function fmt(v: number | string): string {
  if (typeof v === 'string') return v;
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  return Math.abs(v) < 1 ? v.toFixed(3) : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function ExplainDrawer({ title, explanation: e, onClose }: Open & { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    prev.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      (prev.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="explain-title">
        <div className="drawer-head">
          <div>
            <p className="mono text-xs muted m-0">How was this calculated?</p>
            <h2 id="explain-title" className="h-section m-0">
              {title}
            </h2>
          </div>
          <button ref={closeRef} className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body flex flex-col gap-6">
          <p className="text-lg leading-relaxed m-0">{e.plainWords}</p>
          <dl className="grid gap-4 m-0">
            <div>
              <dt className="text-sm muted">Method</dt>
              <dd className="m-0 font-semibold">{e.method}</dd>
            </div>
            {e.formula ? (
              <div>
                <dt className="text-sm muted">Formula</dt>
                <dd className="m-0">
                  <code className="mono block text-[13px] leading-relaxed p-3 box-well" style={{ background: 'var(--paper-2)', wordBreak: 'break-word' }}>
                    {e.formula}
                  </code>
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-sm muted">Source</dt>
              <dd className="m-0">{e.citation}</dd>
            </div>
          </dl>
          {Object.keys(e.inputs).length ? (
            <div>
              <h3 className="text-sm muted font-normal mb-2">Inputs</h3>
              <table className="table">
                <tbody>
                  {Object.entries(e.inputs).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono text-[13px]">{k}</td>
                      <td className="mono text-[13px] r">{fmt(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="text-sm muted m-0">The language model never sets this number. It comes from the engine, which is deterministic: the same inputs and seed always give the same result.</p>
        </div>
      </div>
    </>
  );
}

/** The small [?] next to every number. */
export function ExplainButton({ title, explanation, label }: { title: string; explanation: Explanation | undefined; label?: string }) {
  const ctx = useContext(Ctx);
  if (!explanation || !ctx) return null;
  return (
    <button type="button" className="explain-btn" aria-label={`How was this calculated: ${label ?? title}`} title="How was this calculated?" onClick={() => ctx.open({ title, explanation })}>
      ?
    </button>
  );
}
