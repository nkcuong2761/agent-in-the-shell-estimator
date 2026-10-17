/**
 * Static demo data bundled into the Pages build: seed history (fake) and the precomputed AI outputs
 * for the three samples. Everything here is fictional.
 */
import { z } from 'zod';
import type { BriefPack, ProjectType } from '@scopewise/shared';
import { BriefPack as BriefSchema, DemoCacheEntry, DemoPostmortems, HistoryItem, HistoryProject, ProjectType as ProjectTypeSchema, Squad, Worklog } from '@scopewise/shared';
import projectsJson from '@data/seed/projects.json';
import itemsJson from '@data/seed/items.json';
import squadsJson from '@data/seed/squads.json';
import worklogsJson from '@data/seed/worklogs.json';
import samplesJson from '@data/demo-cache/samples.json';
import remindersJson from '@data/demo-cache/investor-reminders.json';
import formJson from '@data/demo-cache/subscription-form.json';
import syncJson from '@data/demo-cache/fund-admin-sync.json';

export interface SampleMeta {
  id: string;
  title: string;
  client: string;
  clientDeadline: string;
  projectType: ProjectType;
  squad: string;
  startDate: string;
}

export interface Sample {
  meta: SampleMeta;
  brief: BriefPack;
  cache: DemoCacheEntry;
}

// Validated at load: bundled JSON is a boundary like any other.
export const seed = {
  projects: z.array(HistoryProject).parse(projectsJson),
  items: z.array(HistoryItem).parse(itemsJson),
  squads: z.array(Squad).parse(squadsJson),
  worklogs: z.array(Worklog).parse(worklogsJson),
};

const caches: Record<string, DemoCacheEntry> = {
  'investor-reminders': DemoCacheEntry.parse(remindersJson),
  'subscription-form': DemoCacheEntry.parse(formJson),
  'fund-admin-sync': DemoCacheEntry.parse(syncJson),
};

const SampleFile = z.array(
  z.object({
    meta: z.object({ id: z.string(), title: z.string(), client: z.string(), clientDeadline: z.string(), projectType: ProjectTypeSchema, squad: z.string(), startDate: z.string() }),
    brief: BriefSchema,
  }),
);

export const samples: Sample[] = SampleFile.parse(samplesJson).map((s) => ({
  ...s,
  cache: caches[s.meta.id] as DemoCacheEntry,
}));

export function sampleById(id: string | undefined): Sample | undefined {
  return samples.find((s) => s.meta.id === id);
}

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  'new-feature': 'New feature',
  'form-digitization': 'Form digitization',
  integration: 'Integration',
  'data-migration': 'Data migration',
  reporting: 'Reporting',
};

/** Lazily loaded: only the Learning screen needs the precomputed post-mortems. */
export const loadPostmortems = () => import('@data/demo-cache/postmortems.json').then((m) => DemoPostmortems.parse(m.default));
