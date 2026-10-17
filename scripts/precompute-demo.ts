/**
 * Build data/demo-cache: everything the GitHub Pages demo needs that would otherwise come from Claude.
 *
 *   npm run precompute            offline: scope fixtures + deterministic heuristic panel / post-mortems
 *   npm run precompute -- --live  real agents (needs ANTHROPIC_API_KEY); falls back per step on failure
 *
 * Every output carries a Provenance record so the UI can say where it came from.
 */
import { join } from 'node:path';
import type {
  AskScriptEntry,
  DemoCacheEntry,
  DemoPostmortems,
  PanelResult,
  PostmortemResult,
  Provenance,
  ScopeResult,
  ScopeRisk,
} from '@scopewise/shared';
import { DemoCacheEntry as DemoCacheSchema, DemoPostmortems as DemoPostmortemsSchema, ROLE_LABELS } from '@scopewise/shared';
import {
  OFFLINE_PANEL_VERSION,
  buildAnalogIndex,
  findAnalogs,
  offlinePanel,
  offlinePostmortem,
  predictScopeRisks,
  prepareEstimate,
  runEstimate,
  whatIf,
  historyOverhead,
} from '@scopewise/engine';
import { loadSamples, loadSeed, teamOf, type Sample } from './demo-common';
import { SCOPE_FIXTURES, SCOPE_FIXTURE_VERSION } from './fixtures/scope';
import { DATA, arg, writeJson } from './lib';

const GENERATED_AT = '2026-10-17';
const LIVE = arg('live');
const OUT = join(DATA, 'demo-cache');
const seed = loadSeed();

const fixture = (promptVersion: string, generatedBy: Provenance['generatedBy']): Provenance => ({ promptVersion, generatedBy, generatedAt: GENERATED_AT });

/** Live agents are loaded lazily so the offline path never needs the API's dependencies or a key. */
async function liveAgents() {
  if (!LIVE) return null;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('--live given but ANTHROPIC_API_KEY is not set; using offline outputs.');
    return null;
  }
  return import('../apps/api/src/agents/index');
}

function phraseRisk(r: ScopeRisk): ScopeRisk {
  const title = r.description.split(' was added')[0] ?? r.description;
  return { ...r, clientQuestion: `Similar projects often added “${title.toLowerCase()}” after kickoff. Should we plan for it now?` };
}

function scopeRisksFor(scope: ScopeResult): ScopeRisk[] {
  return predictScopeRisks(seed.projects, seed.items, scope.projectType).map(phraseRisk);
}

function askScript(sample: Sample, scope: ScopeResult, panel: PanelResult): AskScriptEntry[] {
  const squad = seed.squads.find((s) => s.id === sample.meta.squad);
  const team = teamOf(squad);
  const prep = prepareEstimate({
    scope,
    panel,
    history: { projects: seed.projects, items: seed.items, squads: seed.squads },
    squad: squad?.stats ?? { focusFactor: 0.75, absenceRate: 0.08, coordinationOverheadPerExtra: 0.1 },
    plannedLeave: squad?.plannedLeave ?? [],
    teamShape: team,
    startDate: sample.meta.startDate,
    deadline: sample.meta.clientDeadline,
  });
  const est = runEstimate(prep);
  const h = (x: number) => `${Math.round(x).toLocaleString('en-US')}h`;
  const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
  const top = est.rankedQuestions[0];
  const plusOne = { ...team, engineer: (team.engineer ?? 0) + 1 };
  const bigger = whatIf(prep, plusOne);
  const biasLines = [...prep.biases.values()]
    .filter((b) => Math.abs(b.value.factor - 1) >= 0.05 && scope.items.some((i) => i.category === b.value.category))
    .sort((a, b) => Math.abs(b.value.factor - 1) - Math.abs(a.value.factor - 1))
    .slice(0, 3)
    .map((b) => `- ${b.value.category}: ×${b.value.factor.toFixed(2)} from ${b.value.n} past items`);
  return [
    {
      question: 'Why is the range so wide?',
      answer:
        `The work is ${h(est.total.p50)} at P50 and ${h(est.total.p80)} at P80. ${est.rankedQuestions.length} questions are still open, and each one widens the items it touches. ` +
        (top ? `The biggest is “${top.question}”: answering it narrows the range by about ${h(top.narrowsByH)}.` : ''),
      toolCalls: [{ name: 'get_estimate', summary: `P50 ${h(est.total.p50)}, P80 ${h(est.total.p80)}, confidence ${est.confidence}` }],
    },
    {
      question: 'What if we add another engineer?',
      answer:
        `With ${plusOne.engineer} engineers instead of ${team.engineer ?? 0}, the P50 finish moves from ${est.p50Date} to ${bigger.p50Date}, and the chance of meeting ${sample.meta.clientDeadline} goes from ${pct(est.onTimeProbability)} to ${pct(bigger.onTimeProbability)}. ` +
        `Total effort rises slightly, from ${h(est.total.p50)} to ${h(bigger.total.p50)}, because each extra person adds coordination time.`,
      toolCalls: [{ name: 'run_what_if', summary: `${ROLE_LABELS.engineer}: ${team.engineer ?? 0} → ${plusOne.engineer}` }],
    },
    {
      question: 'Which question should I ask the client first?',
      answer: top
        ? `Ask “${top.question}” first. It narrows the range by about ${h(top.narrowsByH)}, more than any other open question.${est.rankedQuestions[1] ? ` Next is “${est.rankedQuestions[1].question}” (~${h(est.rankedQuestions[1].narrowsByH)}).` : ''}`
        : 'All questions are answered.',
      toolCalls: [{ name: 'get_estimate', summary: `${est.rankedQuestions.length} ranked questions` }],
    },
    {
      question: 'How was the buffer calculated?',
      answer:
        `The buffer is ${h(est.buffer.total)}, in three parts. Task risk is ${h(est.buffer.task)}: the root-square of each item's P80−P50 gap. ` +
        `Open questions add ${h(est.buffer.missingInfo)}, and absence adds ${h(est.buffer.availability)} (${Math.round((squad?.stats.absenceRate ?? 0) * 100)}% of P50 hours). ` +
        `Committing to ΣP50 + buffer gives ${h(est.commitHours)}, landing on ${est.commitDate}.`,
      toolCalls: [{ name: 'explain_number', summary: 'buffer.total' }],
    },
    {
      question: `What have past ${scope.projectType} projects taught us?`,
      answer:
        `Projects like this took ${h(est.referenceClass.p20)}–${h(est.referenceClass.p80)} (median ${h(est.referenceClass.median)}, ${est.referenceClass.n} projects). The engine corrects guesses by category:\n${biasLines.join('\n') || '- no strong category bias'}\n` +
        (scope.scopeRisks[0] ? `Watch for scope additions: ${scope.scopeRisks[0].description}` : ''),
      toolCalls: [{ name: 'explain_number', summary: 'referenceClass' }],
    },
  ];
}

async function main() {
  const live = await liveAgents();
  const samples = loadSamples();
  writeJson(join(OUT, 'samples.json'), samples.map((s) => ({ meta: s.meta, brief: s.brief })));

  const overhead = historyOverhead(seed.projects, seed.squads);
  const index = buildAnalogIndex(seed.items, seed.projects, overhead);

  for (const sample of samples) {
    let scope: ScopeResult;
    let scopeProvenance: Provenance;
    const fixtureScope = SCOPE_FIXTURES[sample.meta.id];
    if (live) {
      const r = await live.runScopeAgent(sample.brief, { lessons: [] });
      scope = r.scope;
      scopeProvenance = r.provenance;
    } else if (fixtureScope) {
      scope = { ...fixtureScope, scopeRisks: scopeRisksFor(fixtureScope) };
      scopeProvenance = fixture(SCOPE_FIXTURE_VERSION, 'fixture');
    } else {
      throw new Error(`No scope fixture for ${sample.meta.id}`);
    }

    const analogs = scope.items.map((i) => findAnalogs(i, index).value);
    let panel: PanelResult;
    let panelProvenance: Provenance;
    if (live) {
      const r = await live.runPanel(sample.brief, scope, analogs);
      panel = r.panel;
      panelProvenance = r.provenance;
    } else {
      panel = offlinePanel(scope, analogs);
      panelProvenance = fixture(OFFLINE_PANEL_VERSION, 'offline-heuristic');
    }

    const entry: DemoCacheEntry = DemoCacheSchema.parse({
      briefId: sample.meta.id,
      scope,
      scopeProvenance,
      panel,
      panelProvenance,
      ask: askScript(sample, scope, panel),
    });
    writeJson(join(OUT, `${sample.meta.id}.json`), entry);
    console.log(`${sample.meta.id}: ${scope.items.length} items, ${scope.phases.length} phases, ${scope.missingInfo.length} questions, ${scope.scopeRisks.length} risks (${scopeProvenance.generatedBy})`);
  }

  const closed = seed.projects.filter((p) => p.status === 'closed');
  let results: PostmortemResult[];
  let provenance: Provenance;
  if (live) {
    results = [];
    const provenances: Provenance[] = [];
    for (const p of closed) {
      const r = await live.runPostmortem(p, seed.items);
      results.push(r.result);
      provenances.push(r.provenance);
    }
    // One provenance for the file: Claude's if any project used it (runPostmortem falls back per project).
    provenance = provenances.find((x) => x.generatedBy === 'claude') ?? provenances[0] ?? fixture('offline-heuristic-postmortem@1', 'offline-heuristic');
  } else {
    results = closed.map((p) => offlinePostmortem(p, seed.items));
    provenance = fixture('offline-heuristic-postmortem@1', 'offline-heuristic');
  }
  const pm: DemoPostmortems = DemoPostmortemsSchema.parse({ provenance, results });
  writeJson(join(OUT, 'postmortems.json'), pm);
  console.log(`postmortems: ${results.length} projects, ${results.reduce((s, r) => s + r.findings.filter((f) => f.suspectedDataError).length, 0)} suspected data errors`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
