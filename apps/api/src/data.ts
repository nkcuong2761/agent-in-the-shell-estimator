/**
 * Bundled data: seed history, demo-cache lessons and the versioned prompts.
 *
 * JSON is imported with import attributes so bundlers and Vercel's file tracer include it with the function.
 * Prompts are read with fs from `prompts/` at the repo root; each path is a static `new URL(..., import.meta.url)`
 * so the tracer can follow it, and vercel.json also lists `prompts/**` in includeFiles as a belt-and-braces.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DemoPostmortems, HistoryItem, HistoryProject, ProjectType, Squad, Worklog, type Lesson } from '@scopewise/shared';
import projectsJson from '../../../data/seed/projects.json' with { type: 'json' };
import itemsJson from '../../../data/seed/items.json' with { type: 'json' };
import squadsJson from '../../../data/seed/squads.json' with { type: 'json' };
import worklogsJson from '../../../data/seed/worklogs.json' with { type: 'json' };
import postmortemsJson from '../../../data/demo-cache/postmortems.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };

export const API_VERSION: string = pkg.version;

export interface SeedHistory {
  projects: HistoryProject[];
  items: HistoryItem[];
  squads: Squad[];
  worklogs: Worklog[];
}

let seedCache: SeedHistory | null = null;

/** Seed history, validated once with zod and memoised. */
export function loadSeedHistory(): SeedHistory {
  seedCache ??= {
    projects: z.array(HistoryProject).parse(projectsJson),
    items: z.array(HistoryItem).parse(itemsJson),
    squads: z.array(Squad).parse(squadsJson),
    worklogs: z.array(Worklog).parse(worklogsJson),
  };
  return seedCache;
}

/** Lessons from the precomputed post-mortems, used to seed an empty store. */
export function seedLessons(): Lesson[] {
  const pm = DemoPostmortems.parse(postmortemsJson);
  const out: Lesson[] = [];
  for (const r of pm.results) {
    r.lessons.forEach((l, i) => {
      const projectType = ProjectType.safeParse(l.appliesTo.projectType);
      out.push({
        id: `seed-${r.projectId}-${i + 1}`,
        projectId: r.projectId,
        cause: l.cause,
        note: l.note,
        appliesTo: { category: l.appliesTo.category, projectType: projectType.success ? projectType.data : undefined },
        createdAt: pm.provenance.generatedAt,
        source: 'seed',
      });
    });
  }
  return out;
}

// --- prompts ---------------------------------------------------------------------------------

export type PromptName = 'scope' | 'scope-risk' | 'panel-delivery-lead' | 'panel-qa-lead' | 'panel-domain-expert' | 'postmortem' | 'ask';

const PROMPT_URLS: Record<PromptName, URL> = {
  scope: new URL('../../../prompts/scope.md', import.meta.url),
  'scope-risk': new URL('../../../prompts/scope-risk.md', import.meta.url),
  'panel-delivery-lead': new URL('../../../prompts/panel-delivery-lead.md', import.meta.url),
  'panel-qa-lead': new URL('../../../prompts/panel-qa-lead.md', import.meta.url),
  'panel-domain-expert': new URL('../../../prompts/panel-domain-expert.md', import.meta.url),
  postmortem: new URL('../../../prompts/postmortem.md', import.meta.url),
  ask: new URL('../../../prompts/ask.md', import.meta.url),
};

export interface Prompt {
  name: PromptName;
  /** e.g. `scope@1`, stored as `promptVersion` with every output. */
  version: string;
  text: string;
}

const promptCache = new Map<PromptName, Prompt>();

function promptCandidates(name: PromptName): string[] {
  const file = `${name}.md`;
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    fileURLToPath(PROMPT_URLS[name]),
    // The Vercel bundle (api/index.js) ships with a copy of prompts/ next to it, inside the function's root.
    resolve(here, '..', 'prompts', file),
    join(process.cwd(), 'prompts', file),
    join(process.cwd(), '..', '..', 'prompts', file),
    resolve(here, '..', '..', '..', 'prompts', file),
  ];
}

/** Parse `version: <id>` on the first line, then everything after the first `---` line. */
export function parsePrompt(name: PromptName, raw: string): Prompt {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const m = /^version:\s*(\S+)\s*$/.exec(lines[0] ?? '');
  if (!m?.[1]) throw new Error(`prompts/${name}.md must start with a "version: ${name}@N" line`);
  const sep = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  const text = lines.slice(sep >= 0 ? sep + 1 : 1).join('\n').trim();
  return { name, version: m[1], text };
}

export function loadPrompt(name: PromptName): Prompt {
  const cached = promptCache.get(name);
  if (cached) return cached;
  const path = promptCandidates(name).find((p) => existsSync(p));
  if (!path) throw new Error(`Prompt prompts/${name}.md not found (looked in: ${promptCandidates(name).join(', ')})`);
  const prompt = parsePrompt(name, readFileSync(path, 'utf8'));
  promptCache.set(name, prompt);
  return prompt;
}
