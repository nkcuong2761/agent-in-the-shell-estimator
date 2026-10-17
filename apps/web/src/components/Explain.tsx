import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Explanation } from '@scopewise/shared';
import { Icon } from './ui';

/**
 * "See the full working and methods": the only place technical terms appear, always after a plain sentence.
 * The drawer root is marked data-methods so the banned-terms test can skip it.
 */
interface Entry {
  title: string;
  explanation: Explanation;
}
interface Open {
  title: string;
  intro?: string;
  entries: Entry[];
}

const Ctx = createContext<{ open: (o: Open) => void } | null>(null);

export function ExplainProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Open | null>(null);
  const open = useCallback((o: Open) => setCurrent(o), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {current ? <MethodsDrawer {...current} onClose={() => setCurrent(null)} /> : null}
    </Ctx.Provider>
  );
}

export function useMethods() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMethods outside ExplainProvider');
  return ctx.open;
}

function fmt(v: number | string): string {
  if (typeof v === 'string') return v;
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  return Math.abs(v) < 1 ? v.toFixed(3) : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function MethodsDrawer({ title, intro, entries, onClose }: Open & { onClose: () => void }) {
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
      <div className="drawer bezel" role="dialog" aria-modal="true" aria-labelledby="methods-title" data-methods>
        <div className="bezel-core">
          <div className="drawer-head">
            <div>
              <p className="text-sm muted m-0">The full working</p>
              <h2 id="methods-title" className="h-card m-0">
                {title}
              </h2>
            </div>
            <button ref={closeRef} className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
          <div className="drawer-body flex flex-col gap-5">
            {intro ? <p className="m-0 text-[15px] leading-relaxed">{intro}</p> : null}
            {entries.map((e) => (
              <details key={e.title} className="panel p-4 group" open={entries.length <= 2}>
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                  <span className="font-semibold">{e.title}</span>
                  <Icon name="down" className="muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="flex flex-col gap-3 mt-3">
                  <p className="m-0 leading-relaxed">{e.explanation.plainWords}</p>
                  <p className="m-0 text-sm">
                    <span className="muted">Method: </span>
                    {e.explanation.method}
                  </p>
                  {e.explanation.formula ? (
                    <code className="code block text-[13px] leading-relaxed p-3 rounded-xl" style={{ background: 'var(--surface)', wordBreak: 'break-word' }}>
                      {e.explanation.formula}
                    </code>
                  ) : null}
                  <p className="m-0 text-sm muted">Source: {e.explanation.citation}</p>
                  {Object.keys(e.explanation.inputs).length ? (
                    <table className="table">
                      <tbody>
                        {Object.entries(e.explanation.inputs).map(([k, v]) => (
                          <tr key={k}>
                            <td className="code text-[13px]">{k}</td>
                            <td className="code text-[13px] r">{fmt(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              </details>
            ))}
            <p className="text-sm muted m-0">The language model never sets these numbers. They come from the estimating engine, which is deterministic: the same inputs always give the same result.</p>
          </div>
        </div>
      </div>
    </>
  );
}
