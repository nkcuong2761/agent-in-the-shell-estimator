/**
 * Prompt regression checks on the three sample brief packs.
 *
 *   npm run eval              checks data/demo-cache/<id>.json (offline, no key needed)
 *   npm run eval -- --live    runs the scope agent + panel with Claude (needs ANTHROPIC_API_KEY)
 *
 * Checks per sample: ≥ 8 items; items cover every phase of the scope's template; every item cites a source from
 * the brief; ≥ 3 missing-info questions; every planted gap is mentioned by a question (missingInfo question/why
 * or a scope-risk clientQuestion); the client email has the {{questions}} placeholder; the panel has 3 personas
 * that each estimate every item. Prints a table and exits 1 on any failure.
 */
import { join } from 'node:path';
import type { DemoCacheEntry, PanelResult, ScopeResult } from '@scopewise/shared';
import { DemoCacheEntry as DemoCacheSchema, PHASE_TEMPLATES } from '@scopewise/shared';
import { loadSamples, type Sample } from './demo-common';
import { DATA, ROOT, arg, readJson } from './lib';

const LIVE = arg('live');

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export function checkSample(sample: Sample, scope: ScopeResult, panel: PanelResult): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  add('items >= 8', scope.items.length >= 8, `${scope.items.length} items`);

  const template = PHASE_TEMPLATES[scope.projectType];
  const used = new Set(scope.items.map((i) => i.phaseId));
  const uncovered = template.filter((p) => !used.has(p.id)).map((p) => p.id);
  const foreign = [...used].filter((id) => !template.some((p) => p.id === id));
  add(
    'phase coverage',
    uncovered.length === 0 && foreign.length === 0,
    `${scope.projectType}: ${template.length - uncovered.length}/${template.length}${uncovered.length ? `, missing ${uncovered.join(',')}` : ''}${foreign.length ? `, not in template ${foreign.join(',')}` : ''}`,
  );

  const names = new Set(sample.brief.sources.map((s) => s.name));
  const badRefs = scope.items.filter((i) => i.sourceRefs.length === 0 || i.sourceRefs.some((r) => !names.has(r.source)));
  add('sourceRefs valid', badRefs.length === 0, badRefs.length ? `bad: ${badRefs.map((i) => i.id).join(',')}` : `${scope.items.length}/${scope.items.length} cite ${[...names].join('/')}`);

  add('missingInfo >= 3', scope.missingInfo.length >= 3, `${scope.missingInfo.length} questions`);

  const corpus = [
    ...scope.missingInfo.flatMap((q) => [q.question, q.why]),
    ...scope.scopeRisks.map((r) => r.clientQuestion ?? ''),
  ].map((s) => s.toLowerCase());
  const missed = sample.meta.plantedGaps.filter((g) => !g.keywords.some((k) => corpus.some((t) => t.includes(k.toLowerCase()))));
  add(
    'planted gaps asked',
    missed.length === 0,
    `${sample.meta.plantedGaps.length - missed.length}/${sample.meta.plantedGaps.length}${missed.length ? `, missed ${missed.map((g) => g.id).join(',')}` : ''}`,
  );

  add('email {{questions}}', scope.clientEmailDraft.includes('{{questions}}'), scope.clientEmailDraft.includes('{{questions}}') ? 'placeholder present' : 'placeholder missing');

  const personas = new Set(panel.agents.map((a) => a.persona));
  const ids = scope.items.map((i) => i.id);
  const gaps = panel.agents.flatMap((a) => ids.filter((id) => !a.items.some((g) => g.itemId === id)).map((id) => `${a.persona}:${id}`));
  add('panel 3x all items', panel.agents.length === 3 && personas.size === 3 && gaps.length === 0, gaps.length ? `missing ${gaps.slice(0, 4).join(',')}${gaps.length > 4 ? '…' : ''}` : `${personas.size} personas x ${ids.length} items`);

  return checks;
}

async function outputsFor(sample: Sample): Promise<{ scope: ScopeResult; panel: PanelResult; source: string }> {
  if (!LIVE) {
    const entry: DemoCacheEntry = DemoCacheSchema.parse(readJson(join(DATA, 'demo-cache', `${sample.meta.id}.json`)));
    return { scope: entry.scope, panel: entry.panel, source: `${entry.scopeProvenance.generatedBy}:${entry.scopeProvenance.promptVersion}` };
  }
  const { loadDotEnv } = await import('../apps/api/src/dotenv');
  loadDotEnv(join(ROOT, 'apps', 'api', '.env'));
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('--live needs ANTHROPIC_API_KEY (env or apps/api/.env).');
  const agents = await import('../apps/api/src/agents/index');
  const { seedLessons, loadSeedHistory } = await import('../apps/api/src/data');
  const { analogsFor } = await import('../apps/api/src/engineRun');
  const s = await agents.runScopeAgent(sample.brief, { lessons: seedLessons() });
  const p = await agents.runPanel(sample.brief, s.scope, analogsFor(s.scope, loadSeedHistory()));
  return { scope: s.scope, panel: p.panel, source: `claude:${s.provenance.promptVersion}` };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  const samples = loadSamples();
  const rows: { sample: string; check: Check }[] = [];
  for (const sample of samples) {
    try {
      const { scope, panel, source } = await outputsFor(sample);
      console.log(`${sample.meta.id}: ${source}`);
      for (const check of checkSample(sample, scope, panel)) rows.push({ sample: sample.meta.id, check });
    } catch (err) {
      rows.push({ sample: sample.meta.id, check: { name: 'run', pass: false, detail: err instanceof Error ? err.message : String(err) } });
    }
  }
  console.log('');
  const w = [Math.max(6, ...rows.map((r) => r.sample.length)), Math.max(5, ...rows.map((r) => r.check.name.length)), 4];
  const line = `+-${'-'.repeat(w[0] as number)}-+-${'-'.repeat(w[1] as number)}-+-${'-'.repeat(w[2] as number)}-+-${'-'.repeat(40)}`;
  console.log(line);
  console.log(`| ${pad('sample', w[0] as number)} | ${pad('check', w[1] as number)} | ${pad('ok', w[2] as number)} | detail`);
  console.log(line);
  for (const r of rows) console.log(`| ${pad(r.sample, w[0] as number)} | ${pad(r.check.name, w[1] as number)} | ${pad(r.check.pass ? 'pass' : 'FAIL', w[2] as number)} | ${r.check.detail}`);
  console.log(line);
  const failed = rows.filter((r) => !r.check.pass).length;
  console.log(failed ? `\n${failed} of ${rows.length} checks failed.` : `\nAll ${rows.length} checks passed.`);
  if (failed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
