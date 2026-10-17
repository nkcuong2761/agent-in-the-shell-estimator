/** Shared helpers for scripts that work with the sample brief packs and seed history. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefPack, HistoryItem, HistoryProject, ProjectType, Squad, TeamShape, Worklog } from '@scopewise/shared';
import { DATA, listDirs, readJson } from './lib';

export interface SampleMeta {
  id: string;
  title: string;
  client: string;
  clientDeadline: string;
  projectType: ProjectType;
  squad: string;
  startDate: string;
  plantedGaps: { id: string; keywords: string[] }[];
}

export interface Sample {
  dir: string;
  meta: SampleMeta;
  brief: BriefPack;
}

const SOURCE_FILES = [
  { file: 'email.md', kind: 'email' },
  { file: 'meeting-notes.md', kind: 'notes' },
  { file: 'jira-ticket.md', kind: 'jira' },
] as const;

export function loadSamples(): Sample[] {
  const root = join(DATA, 'samples');
  return listDirs(root).map((dir) => {
    const meta = readJson<SampleMeta>(join(root, dir, 'brief.json'));
    const brief: BriefPack = {
      id: meta.id,
      title: meta.title,
      clientDeadline: meta.clientDeadline,
      sources: SOURCE_FILES.map((s) => ({ kind: s.kind, name: s.file, text: readFileSync(join(root, dir, s.file), 'utf8') })),
    };
    return { dir, meta, brief };
  });
}

export function loadSeed() {
  const dir = join(DATA, 'seed');
  return {
    projects: readJson<HistoryProject[]>(join(dir, 'projects.json')),
    items: readJson<HistoryItem[]>(join(dir, 'items.json')),
    squads: readJson<Squad[]>(join(dir, 'squads.json')),
    worklogs: readJson<Worklog[]>(join(dir, 'worklogs.json')),
  };
}

export function teamOf(squad: Squad | undefined): TeamShape {
  const t: TeamShape = {};
  for (const m of squad?.members ?? []) t[m.role] = m.count;
  return t;
}
