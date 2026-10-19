/**
 * Finished Jira tickets imported as real projects. The API store is the source of truth (POST /jira/import,
 * GET /jira/imports); the browser keeps a mirror in localStorage so a reload still shows the page, and merges
 * what the API has whenever the app is in live mode. Every project here carries the label "real".
 */
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { RealProject } from '@scopewise/shared';
import { api } from '../lib/api';
import { readStore, writeStore } from '../lib/storage';

const KEY = 'scopewise.realProjects.v1';
const Stored = z.object({ version: z.literal(1), projects: z.array(RealProject) });

let projects: RealProject[] = load();
let version = 0;
const listeners = new Set<() => void>();

function load(): RealProject[] {
  const parsed = Stored.safeParse(readStore<unknown>(KEY, null));
  return parsed.success ? parsed.data.projects : [];
}

function commit(next: RealProject[]) {
  projects = next.sort((a, b) => a.project.endDate.localeCompare(b.project.endDate));
  version += 1;
  writeStore(KEY, { version: 1, projects });
  for (const l of listeners) l();
}

export function realProjects(): RealProject[] {
  return projects;
}

export function realProjectsVersion(): number {
  return version;
}

export function addRealProject(p: RealProject) {
  commit([...projects.filter((x) => x.project.id !== p.project.id), p]);
}

export function subscribeRealProjects(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Live mode: take the API's list (imports made elsewhere, or re-imported with fresher data) over the local mirror. */
let inflight: Promise<void> | null = null;
export function syncRealProjects(): Promise<void> {
  if (inflight) return inflight;
  inflight = api
    .jiraImports()
    .then(({ projects: remote }) => {
      if (!remote.length) return;
      const byId = new Map(projects.map((p) => [p.project.id, p]));
      let changed = false;
      for (const r of remote) {
        if (byId.get(r.project.id)?.importedAt !== r.importedAt) changed = true;
        byId.set(r.project.id, r);
      }
      if (changed) commit([...byId.values()]);
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** What the user told us about a ticket: kept here and, when an API answers, in its store too. */
export function updateRealProject(p: RealProject) {
  addRealProject(p);
  void api.saveRealProject(p).catch(() => undefined);
}

/** For tests and the demo reset. */
export function setRealProjects(next: RealProject[]) {
  commit(next);
}

export function useRealProjects(): { projects: RealProject[]; version: number } {
  const v = useSyncExternalStore(subscribeRealProjects, realProjectsVersion, realProjectsVersion);
  return { projects, version: v };
}
