import { useEffect, useState } from 'react';
import type { BacktestPoint, DemoPostmortems, HistoryProject } from '@scopewise/shared';
import { backtest } from '@scopewise/engine';
import { loadPostmortems, seed } from '../lib/data';
import { toOutcome, type ProjectOutcome } from '../present/project';

export interface FinishedProject {
  project: HistoryProject;
  point: BacktestPoint;
  outcome: ProjectOutcome;
}

export interface History {
  finished: FinishedProject[];
  points: BacktestPoint[];
}

let cached: History | null = null;
let pending: Promise<History> | null = null;

/** Replays every closed project (walk-forward backtest) once per session. */
function compute(): Promise<History> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = new Promise((resolve) => {
      window.setTimeout(() => {
        const r = backtest(seed, { runs: 250 }).value;
        const byId = new Map(seed.projects.map((p) => [p.id, p]));
        const finished = r.points
          .map((point) => {
            const project = byId.get(point.projectId);
            return project ? { project, point, outcome: toOutcome(project, point) } : undefined;
          })
          .filter((x): x is FinishedProject => !!x);
        cached = { finished, points: r.points };
        resolve(cached);
      }, 60);
    });
  }
  return pending;
}

export function useHistory(): History | null {
  const [h, setH] = useState<History | null>(cached);
  useEffect(() => {
    let alive = true;
    void compute().then((x) => alive && setH(x));
    return () => {
      alive = false;
    };
  }, []);
  return h;
}

let pmCache: DemoPostmortems | null = null;
export function usePostmortems(): DemoPostmortems | null {
  const [pm, setPm] = useState<DemoPostmortems | null>(pmCache);
  useEffect(() => {
    if (pmCache) return;
    let alive = true;
    void loadPostmortems().then((d) => {
      pmCache = d;
      if (alive) setPm(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return pm;
}
