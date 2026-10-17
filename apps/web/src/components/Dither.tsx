import { useEffect, useMemo, useRef, useState } from 'react';
import type { Histogram } from '@scopewise/shared';

/** 4×4 ordered-dither (Bayer) threshold matrix. */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export function bayerOn(x: number, y: number, density: number): boolean {
  const row = BAYER4[y & 3] as readonly number[];
  return (row[x & 3] as number) < density * 16;
}

function maskSvg(density: number): string {
  let rects = '';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (bayerOn(x, y, density)) rects += `<rect x='${x}' y='${y}' width='1' height='1'/>`;
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4' shape-rendering='crispEdges'>${rects}</svg>`)}")`;
}

/** Inject the dither masks as CSS custom properties once. */
export function installDitherMasks(): void {
  const root = document.documentElement.style;
  const levels: [string, number][] = [
    ['75', 0.75],
    ['50', 0.5],
    ['25', 0.25],
    ['12', 0.125],
    ['6', 0.0625],
  ];
  for (const [k, d] of levels) root.setProperty(`--dither-${k}`, maskSvg(d));
}

export type Density = 100 | 75 | 50 | 25 | 12 | 6;
export type Tone = 'ink' | 'blue' | 'pink' | 'graphite';

export interface Segment {
  from: number;
  to: number;
  density: Density;
  tone?: Tone;
  label?: string;
}

/** A horizontal bar built from dithered segments on a 0..max scale. */
export function DitherBar({ segments, max, height = 14, className = '' }: { segments: Segment[]; max: number; height?: number; className?: string }) {
  return (
    <div className={`relative w-full ${className}`} style={{ height }} aria-hidden="true">
      {segments.map((s, i) => {
        const left = (Math.max(0, s.from) / max) * 100;
        const width = (Math.max(0, s.to - s.from) / max) * 100;
        return (
          <span
            key={i}
            className={`dither d-${s.density} ${s.tone && s.tone !== 'ink' ? `dc-${s.tone}` : ''} absolute top-0 bottom-0`}
            style={{ left: `${left}%`, width: `${width}%` }}
            title={s.label}
          />
        );
      })}
    </div>
  );
}

/** A swatch for legends. */
export function Swatch({ density, tone = 'ink', w = 18, h = 10 }: { density: Density; tone?: Tone; w?: number; h?: number }) {
  return <span aria-hidden="true" className={`dither d-${density} ${tone !== 'ink' ? `dc-${tone}` : ''} inline-block align-middle`} style={{ width: w, height: h }} />;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
}

function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const bump = () => setV((x) => x + 1);
    mq.addEventListener('change', bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', bump);
      mo.disconnect();
    };
  }, []);
  return v;
}

function usePrefersReducedMotion(): boolean {
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return r;
}

export interface Marker {
  at: number;
  label: string;
  tone: Tone;
}

/**
 * Monte Carlo outcomes drawn as an ordered-dither histogram.
 * Ink density encodes certainty: solid up to P50, half-tone to P80, sparse in the tail.
 */
export function DitherHistogram({
  histogram,
  p50,
  p80,
  markers = [],
  height = 180,
  dot = 3,
  animate = false,
  ariaLabel,
  unit = 'h',
}: {
  histogram: Histogram;
  p50: number;
  p80: number;
  markers?: Marker[];
  height?: number;
  dot?: number;
  animate?: boolean;
  ariaLabel: string;
  unit?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const theme = useThemeVersion();
  const reduced = usePrefersReducedMotion();
  const played = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Show the central 99% of outcomes; the extreme tail would otherwise squash the plot to one side.
  const { edges, counts, binWidth } = useMemo(() => {
    const total = histogram.counts.reduce((a, b) => a + b, 0);
    let first = 0;
    let last = histogram.counts.length - 1;
    let acc = 0;
    while (first < last && acc + (histogram.counts[first] ?? 0) < total * 0.004) acc += histogram.counts[first++] ?? 0;
    acc = 0;
    while (last > first && acc + (histogram.counts[last] ?? 0) < total * 0.006) acc += histogram.counts[last--] ?? 0;
    return { edges: histogram.edges.slice(first, last + 1), counts: histogram.counts.slice(first, last + 1), binWidth: histogram.binWidth };
  }, [histogram]);
  const lo = edges[0] ?? 0;
  const hi = (edges[edges.length - 1] ?? 1) + binWidth;

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0 || counts.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(width * dpr);
    c.height = Math.floor(height * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const ink = cssVar('--ink');
    const graphite = cssVar('--graphite');
    const max = Math.max(...counts, 1);
    const cols = Math.floor(width / dot);
    const rows = Math.floor(height / dot);
    const xToH = (col: number) => lo + ((col + 0.5) / cols) * (hi - lo);
    const heightAt = (h: number) => {
      const i = Math.min(counts.length - 1, Math.max(0, Math.floor((h - lo) / binWidth)));
      return (counts[i] ?? 0) / max;
    };

    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      for (let col = 0; col < cols; col++) {
        const h = xToH(col);
        const delay = (col / cols) * 0.55;
        const local = Math.min(1, Math.max(0, (t - delay) / 0.45));
        const eased = 1 - Math.pow(1 - local, 3);
        const barRows = Math.round(heightAt(h) * rows * eased);
        const density = h <= p50 ? 1 : h <= p80 ? 0.5 : 0.1875;
        ctx.fillStyle = h <= p80 ? ink : graphite;
        for (let r = 0; r < barRows; r++) {
          const y = rows - 1 - r;
          if (bayerOn(col, y, density)) ctx.fillRect(col * dot, y * dot, dot, dot);
        }
      }
    };

    if (animate && !reduced && !played.current) {
      played.current = true;
      let start = 0;
      let raf = 0;
      const step = (ts: number) => {
        if (!start) start = ts;
        const t = Math.min(1, (ts - start) / 1400);
        draw(t);
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }
    draw(1);
  }, [width, height, dot, counts, lo, hi, binWidth, p50, p80, theme, animate, reduced]);

  const pos = (h: number) => `${((h - lo) / (hi - lo)) * 100}%`;
  const TOP = markers.length ? 20 : 0;
  const pct: Marker[] = [
    { at: p50, label: `P50 ${Math.round(p50)}${unit}`, tone: 'blue' },
    { at: p80, label: `P80 ${Math.round(p80)}${unit}`, tone: 'blue' },
  ];
  const visible = (m: Marker) => m.at >= lo && m.at <= hi;

  return (
    <figure className="m-0">
      <div ref={wrap} className="relative w-full" style={{ height: height + 30 + TOP }}>
        <canvas ref={canvas} role="img" aria-label={ariaLabel} style={{ width: '100%', height, display: 'block', imageRendering: 'pixelated', marginTop: TOP }} />
        {pct.filter(visible).map((m, i) => (
          <div key={m.label} className="absolute" style={{ left: pos(m.at), top: TOP, height: height + 6 }} aria-hidden="true">
            <div className="h-full" style={{ borderLeft: '1px dashed var(--blue)' }} />
            <div
              className="mono absolute whitespace-nowrap text-[11px]"
              style={{ top: height + 10, transform: i === 0 ? 'translateX(-100%)' : 'none', padding: i === 0 ? '0 6px 0 0' : '0 0 0 6px', color: 'var(--blue-ink)' }}
            >
              {m.label}
            </div>
          </div>
        ))}
        {markers.filter(visible).map((m) => (
          <div key={m.label} className="absolute top-0" style={{ left: pos(m.at), height: height + TOP }} aria-hidden="true">
            <div className="absolute" style={{ top: 14, bottom: 0, borderLeft: `2px solid var(--${m.tone === 'pink' ? 'pink' : 'blue'})` }} />
            <div className="mono absolute top-0 whitespace-nowrap text-[11px]" style={{ transform: 'translateX(-50%)', color: m.tone === 'pink' ? 'var(--pink-ink)' : 'var(--blue-ink)' }}>
              {m.label}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
