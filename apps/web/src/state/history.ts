import { useEffect, useState } from 'react';
import type { BacktestPoint, DemoPostmortems, HistoryItem, HistoryProject, PostmortemResult, RealProject, Squad, Worklog } from '@scopewise/shared';
import { backtest } from '@scopewise/engine';
import { loadPostmortems, seed } from '../lib/data';
import { toOutcome, type ProjectOutcome } from '../present/project';
import { realProjects, realProjectsVersion, subscribeRealProjects } from './realProjects';

/** A stand-in backtest point for a ticket without hours, from the hindsight estimate the API stored with it. */
function hindsightPoint(r: RealProject): BacktestPoint {
  const h = r.hindsight as NonNullable<RealProject['hindsight']>;
  return {
    order: -1,
    projectId: r.project.id,
    name: r.project.name,
    actualH: 0,
    rawH: 0,
    calibratedP50: h.effortH,
    calibratedP80: h.safeEffortH,
    calibratedP50Date: h.likelyDate,
    calibratedP80Date: h.safeDate,
    rawMRE: 0,
    calibratedMRE: 0,
    rollingRawMMRE: 0,
    rollingCalibratedMMRE: 0,
    withinP80: r.project.endDate <= h.safeDate,
  };
}

export interface FinishedProject {
  project: HistoryProject;
  point: BacktestPoint;
  outcome: ProjectOutcome;
}

export interface History {
  finished: FinishedProject[];
  points: BacktestPoint[];
}

export interface HistoryData {
  projects: HistoryProject[];
  items: HistoryItem[];
  squads: Squad[];
  worklogs: Worklog[];
}

let merged: { version: number; data: HistoryData } | null = null;

const hasHours = (r: RealProject) => !r.project.labels.includes('dates-only');

/**
 * The fake seed history plus every real finished ticket imported from Jira (labelled "real") that has hours
 * logged. Dates-only tickets stay out: the engine learns from hours, and a 0-hour project would poison the
 * reference class, the analogs and the backtest.
 */
export function historyFor(): HistoryData {
  const v = realProjectsVersion();
  if (merged && merged.version === v) return merged.data;
  const real = realProjects().filter(hasHours);
  const data: HistoryData = real.length
    ? { projects: [...seed.projects, ...real.map((r) => r.project)], items: [...seed.items, ...real.flatMap((r) => r.items)], squads: seed.squads, worklogs: seed.worklogs }
    : seed;
  merged = { version: v, data };
  return data;
}

let cached: { version: number; history: History } | null = null;
let pending: { version: number; promise: Promise<History> } | null = null;

/** Replays every closed project (walk-forward backtest); again whenever a real project is imported. */
function compute(): Promise<History> {
  const version = realProjectsVersion();
  if (cached?.version === version) return Promise.resolve(cached.history);
  if (pending?.version !== version) {
    pending = {
      version,
      promise: new Promise((resolve) => {
        window.setTimeout(() => {
          const data = historyFor();
          const r = backtest(data, { runs: 250 }).value;
          const byId = new Map(data.projects.map((p) => [p.id, p]));
          const finished = r.points
            .map((point) => {
              const project = byId.get(point.projectId);
              return project ? { project, point, outcome: toOutcome(project, point) } : undefined;
            })
            .filter((x): x is FinishedProject => !!x);
          // Dates-only tickets: the page compares calendar time against the hindsight estimate; no chart point.
          for (const r of realProjects()) {
            if (hasHours(r) || !r.hindsight) continue;
            const point = hindsightPoint(r);
            finished.push({ project: r.project, point, outcome: toOutcome(r.project, point) });
          }
          finished.sort((a, b) => a.project.endDate.localeCompare(b.project.endDate));
          cached = { version, history: { finished, points: r.points } };
          resolve(cached.history);
        }, 60);
      }),
    };
  }
  return pending.promise;
}

export function useHistory(): History | null {
  const [h, setH] = useState<History | null>(cached?.history ?? null);
  useEffect(() => {
    let alive = true;
    const run = () => void compute().then((x) => alive && setH(x));
    run();
    const off = subscribeRealProjects(run);
    return () => {
      alive = false;
      off();
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

/** A project's post-mortem: imported tickets carry their own; seed projects use the demo cache. */
export function postmortemFor(projectId: string, pms: DemoPostmortems | null): PostmortemResult | undefined {
  return realProjects().find((r) => r.project.id === projectId)?.postmortem ?? pms?.results.find((r) => r.projectId === projectId);
}

/** Every post-mortem known, for the forecast's "delays seen on similar projects". */
export function allPostmortems(pms: DemoPostmortems | null): PostmortemResult[] {
  return [...(pms?.results ?? []), ...realProjects().map((r) => r.postmortem)];
}
