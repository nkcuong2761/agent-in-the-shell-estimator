/**
 * Generate fake delivery history with a fixed seed: 3 squads, 40 closed projects over ~18 months
 * (~400 items), weekly worklogs, and the 3 open sample projects. All names are invented.
 *
 * Planted patterns (the engine should discover these, not be told them):
 * - integration work overruns ~1.4×; reporting comes in ~0.9×
 * - form digitizations often add an e-signature step after kickoff
 * - squads lose ~8% of planned hours to absence, plus one planned leave inside an open project's window
 * - the first 10 projects are noisier, so the backtest visibly improves
 * - two time-entry typos (10× the estimate) for the post-mortem agent to flag
 *
 * Usage: npm run seed
 */
import type {
  Category,
  Complexity,
  HistoryItem,
  HistoryProject,
  ProjectType,
  Role,
  SeedData,
  Size,
  Squad,
  Worklog,
} from '@scopewise/shared';
import { SeedData as SeedSchema } from '@scopewise/shared';
import { addWorkingDays, mulberry32, nextWorkingDay, normal, scheduleOnce } from '@scopewise/engine';
import { PHASE_TEMPLATES } from '@scopewise/shared';
import { join } from 'node:path';
import { DATA, writeJson } from './lib';

const SEED = 1789;
const rng = mulberry32(SEED);
const lognormal = (sd: number) => Math.exp(sd * normal(rng) - (sd * sd) / 2);
// Separate stream for calendar noise, so the item draws stay the same whatever the schedule does.
const durRng = mulberry32(SEED + 1);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T;
const half = (h: number) => Math.max(1, Math.round(h * 2) / 2);

// --- squads ------------------------------------------------------------------

const squads: Squad[] = [
  {
    id: 'alpha',
    name: 'Squad Alpha',
    members: [
      { role: 'pm', count: 1 },
      { role: 'designer', count: 1 },
      { role: 'engineer', count: 3 },
      { role: 'qa', count: 1 },
      { role: 'legal', count: 0 },
    ],
    stats: { focusFactor: 0.76, absenceRate: 0.08, coordinationOverheadPerExtra: 0.1 },
    plannedLeave: [],
  },
  {
    id: 'beta',
    name: 'Squad Beta',
    members: [
      { role: 'pm', count: 1 },
      { role: 'designer', count: 1 },
      { role: 'engineer', count: 4 },
      { role: 'qa', count: 1 },
      { role: 'legal', count: 1 },
    ],
    stats: { focusFactor: 0.72, absenceRate: 0.08, coordinationOverheadPerExtra: 0.1 },
    plannedLeave: [],
  },
  {
    id: 'gamma',
    name: 'Squad Gamma',
    members: [
      { role: 'pm', count: 1 },
      { role: 'designer', count: 0 },
      { role: 'engineer', count: 2 },
      { role: 'qa', count: 1 },
      { role: 'legal', count: 0 },
    ],
    stats: { focusFactor: 0.8, absenceRate: 0.07, coordinationOverheadPerExtra: 0.1 },
    // Planned leave inside the integration sample's window (fake).
    plannedLeave: [{ role: 'engineer', start: '2026-11-23', end: '2026-12-04', people: 1, note: 'Planned leave: one engineer, two weeks (fake)' }],
  },
];

// --- catalogue -----------------------------------------------------------------

interface Tpl {
  title: string;
  phaseId: string;
  category: Category;
  complexity: Complexity;
  role: Role;
  h: number;
  optional?: boolean;
}
interface Added extends Tpl {
  chance: number;
}

const T = (title: string, phaseId: string, category: Category, complexity: Complexity, role: Role, h: number, optional = false): Tpl => ({
  title, phaseId, category, complexity, role, h, optional,
});
const A = (chance: number, t: Tpl): Added => ({ ...t, chance });

const CATALOGUE: Record<ProjectType, { items: Tpl[]; added: Added[]; names: string[] }> = {
  'new-feature': {
    names: ['investor reminders', 'capital call notices', 'document expiry alerts', 'bulk invite flow', 'side-letter tracker', 'approval routing', 'investor portal search', 'distribution notices', 'KYC refresh prompts', 'commitment changes'],
    items: [
      T('Stakeholder interviews and requirements', 'discovery', 'discovery', 'M', 'pm', 14),
      T('User stories and acceptance criteria', 'discovery', 'discovery', 'S', 'pm', 8),
      T('Wireframes for the main flow', 'design', 'design', 'M', 'designer', 16),
      T('High-fidelity UI and empty/error states', 'design', 'design', 'M', 'designer', 20),
      T('Notification template design', 'design', 'design', 'S', 'designer', 8, true),
      T('Backend service and data model', 'build', 'backend', 'L', 'engineer', 40),
      T('Frontend screens', 'build', 'frontend', 'M', 'engineer', 32),
      T('Notification scheduler', 'build', 'notifications', 'M', 'engineer', 24, true),
      T('Admin settings page', 'build', 'frontend', 'S', 'engineer', 14, true),
      T('Audit log events', 'build', 'backend', 'S', 'engineer', 10, true),
      T('Test plan and regression', 'qa', 'qa', 'M', 'qa', 18),
      T('Email client and browser testing', 'qa', 'qa', 'S', 'qa', 10, true),
      T('Release, feature flag and monitoring', 'go-live', 'devops', 'S', 'engineer', 8),
    ],
    added: [
      A(0.35, T('Status dashboard for operations team', 'build', 'reporting', 'M', 'engineer', 18)),
      A(0.25, T('Localised notification templates', 'build', 'frontend', 'S', 'engineer', 12)),
    ],
  },
  'form-digitization': {
    names: ['subscription form online', 'W-9 intake', 'transfer request form', 'accredited investor questionnaire', 'redemption request form', 'beneficial owner form', 'tax residency form', 'change of address form', 'wire instruction form'],
    items: [
      T('Field inventory of the paper form', 'form-analysis', 'forms', 'M', 'pm', 12),
      T('Validation and conditional logic rules', 'form-analysis', 'forms', 'M', 'pm', 10),
      T('Legal review of disclosures and consent wording', 'legal-review', 'legal', 'M', 'legal', 12),
      T('Data retention sign-off', 'legal-review', 'legal', 'S', 'legal', 6, true),
      T('Multi-step form UI', 'build-form', 'forms', 'L', 'engineer', 36),
      T('Field validation and conditional sections', 'build-form', 'forms', 'M', 'engineer', 20),
      T('Save and resume draft', 'build-form', 'frontend', 'M', 'engineer', 14, true),
      T('PDF of the completed form', 'build-form', 'backend', 'M', 'engineer', 16),
      T('Map form fields to investor records', 'integration', 'integration', 'M', 'engineer', 18),
      T('Write submissions to the records system', 'integration', 'integration', 'M', 'engineer', 22),
      T('Form QA with edge cases', 'qa', 'qa', 'M', 'qa', 16),
      T('Accessibility check', 'qa', 'qa', 'S', 'qa', 8, true),
      T('Launch and paper-to-online cutover', 'go-live', 'devops', 'S', 'engineer', 8),
    ],
    added: [
      A(0.7, T('E-signature step', 'build-form', 'esign', 'M', 'engineer', 28)),
      A(0.3, T('Supporting document upload', 'build-form', 'forms', 'S', 'engineer', 12)),
    ],
  },
  integration: {
    names: ['fund administrator sync', 'CRM contact sync', 'custodian holdings feed', 'KYC provider hookup', 'bank statement import', 'general ledger export', 'transfer agent sync', 'e-sign provider callback', 'data warehouse feed'],
    items: [
      T('Partner API discovery and access', 'discovery', 'discovery', 'M', 'pm', 12),
      T('Data ownership and sync rules', 'discovery', 'discovery', 'S', 'pm', 8),
      T('Field mapping between systems', 'api-mapping', 'integration', 'M', 'engineer', 20),
      T('Identifier matching strategy', 'api-mapping', 'integration', 'M', 'engineer', 14),
      T('API client and authentication', 'build', 'integration', 'M', 'engineer', 18),
      T('Sync job with retries', 'build', 'integration', 'L', 'engineer', 34),
      T('Conflict handling and reconciliation', 'build', 'integration', 'L', 'engineer', 26),
      T('Error alerts and sync status page', 'build', 'backend', 'S', 'engineer', 12, true),
      T('End-to-end tests against partner sandbox', 'integration-testing', 'qa', 'M', 'qa', 20),
      T('Reconciliation test run', 'integration-testing', 'qa', 'M', 'qa', 14),
      T('Production cutover and backfill', 'go-live', 'devops', 'M', 'engineer', 14),
    ],
    added: [
      A(0.4, T('Backfill of historical records', 'build', 'data', 'M', 'engineer', 22)),
      A(0.3, T('Second partner file format', 'build', 'integration', 'M', 'engineer', 18)),
    ],
  },
  'data-migration': {
    names: ['legacy CRM migration', 'document archive move', 'investor ledger migration', 'old portal sunset', 'entity data consolidation'],
    items: [
      T('Source system audit', 'discovery', 'discovery', 'M', 'pm', 12),
      T('Data mapping specification', 'mapping', 'data', 'M', 'engineer', 18),
      T('Cleansing rules', 'mapping', 'data', 'M', 'engineer', 14),
      T('Extract and transform scripts', 'build', 'data', 'L', 'engineer', 30),
      T('Load scripts with validation', 'build', 'data', 'M', 'engineer', 20),
      T('Trial migration and reconciliation', 'trial-migration', 'qa', 'M', 'qa', 18),
      T('Cutover run', 'go-live', 'devops', 'M', 'engineer', 12),
    ],
    added: [A(0.4, T('Archive of legacy attachments', 'build', 'data', 'M', 'engineer', 16))],
  },
  reporting: {
    names: ['quarterly investor report', 'fundraising pipeline report', 'commitment summary export', 'fee breakdown report', 'compliance activity report', 'LP exposure report', 'ops SLA dashboard'],
    items: [
      T('Report requirements workshop', 'discovery', 'discovery', 'S', 'pm', 8),
      T('Report layouts', 'design', 'design', 'S', 'designer', 10),
      T('Data queries and aggregation', 'build', 'reporting', 'M', 'engineer', 22),
      T('Report UI and export', 'build', 'reporting', 'M', 'engineer', 18),
      T('Scheduled delivery', 'build', 'reporting', 'S', 'engineer', 10, true),
      T('Figures verification', 'qa', 'qa', 'S', 'qa', 10),
      T('Release', 'go-live', 'devops', 'S', 'engineer', 4),
    ],
    added: [A(0.3, T('Additional filter set', 'build', 'reporting', 'S', 'engineer', 8))],
  },
};

/** True multipliers of actual vs estimate per category (what the engine should learn). */
const CATEGORY_BIAS: Record<Category, number> = {
  discovery: 0.95,
  design: 1.0,
  frontend: 1.05,
  backend: 1.1,
  integration: 1.4,
  forms: 1.1,
  esign: 1.2,
  notifications: 1.1,
  data: 1.2,
  reporting: 0.9,
  qa: 1.05,
  devops: 1.0,
  legal: 1.15,
};

const SIZE_MULT: Record<Size, number> = { S: 0.6, M: 1.0, L: 1.4, XL: 1.9 };
const CLIENTS = ['Harborlight Partners', 'Copperfen Ventures', 'Tidewell Fund III', 'Oakmere Capital', 'Bluestem & Vale', 'Junoridge Holdings', 'Larkfield Credit', 'Quillstone Partners', 'Saltbrook Ventures', 'Emberwood Real Assets'];
const TYPES: ProjectType[] = [
  ...Array<ProjectType>(10).fill('new-feature'),
  ...Array<ProjectType>(9).fill('form-digitization'),
  ...Array<ProjectType>(9).fill('integration'),
  ...Array<ProjectType>(5).fill('data-migration'),
  ...Array<ProjectType>(7).fill('reporting'),
];

// Deterministic shuffle of project types.
for (let i = TYPES.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [TYPES[i], TYPES[j]] = [TYPES[j] as ProjectType, TYPES[i] as ProjectType];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const addDays = (iso: string, d: number) => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + Math.round(d));
  return x.toISOString().slice(0, 10);
};

function sizeFromHours(h: number): Size {
  if (h < 140) return 'S';
  if (h < 230) return 'M';
  if (h < 330) return 'L';
  return 'XL';
}

const projects: HistoryProject[] = [];
const items: HistoryItem[] = [];
const nameCounters = new Map<ProjectType, number>();
let dataErrorsPlanted = 0;

TYPES.forEach((projectType, idx) => {
  const cat = CATALOGUE[projectType];
  const squad = squads[idx % 3] as Squad;
  const scale = pick<Size>(['S', 'M', 'M', 'L', 'L', 'XL']);
  const noisy = idx < 10;
  const n = nameCounters.get(projectType) ?? 0;
  nameCounters.set(projectType, n + 1);
  const client = CLIENTS[(idx * 7) % CLIENTS.length] as string;
  const projectName = `${client}: ${cat.names[n % cat.names.length]}`;
  const id = `P${String(idx + 1).padStart(3, '0')}`;
  const startDate = nextWorkingDay(addDays('2025-04-07', idx * 10.5 + rng() * 3));
  const leaveOverlap = rng() < 0.15;

  const planned = cat.items.filter((t) => !t.optional || rng() < (scale === 'S' ? 0.35 : 0.7));
  const added = cat.added.filter((a) => rng() < a.chance);
  const projectItems: HistoryItem[] = [];

  const makeItem = (t: Tpl, addedAfterKickoff: boolean, k: number): HistoryItem => {
    const estimate = half(t.h * SIZE_MULT[scale] * lognormal(0.18));
    // Complexity reflects the size of the piece of work, so S projects have S items.
    const complexity: Complexity = estimate < 12 ? 'S' : estimate < 28 ? 'M' : 'L';
    const noise = lognormal(noisy ? 0.42 : 0.16);
    // Observed actual/estimate includes the squad's own coordination overhead; the engine divides it out.
    let actual = estimate * CATEGORY_BIAS[t.category] * noise;
    const blocked = t.category === 'integration' && rng() < 0.2;
    if (blocked) actual *= 1.35;
    if (leaveOverlap && t.role === 'engineer') actual *= 1.12;
    actual = half(actual);
    const seedId = `${id}-${String(k + 1).padStart(2, '0')}`;
    const labels = [
      `type:${projectType}`,
      `phase:${t.phaseId}`,
      `cat:${t.category}`,
      `squad:${squad.id}`,
      `client:${slug(client)}`,
      `seed:${seedId}`,
      ...(blocked ? ['blocked'] : []),
      ...(addedAfterKickoff ? ['added-after-kickoff'] : []),
    ];
    return {
      id: seedId,
      seedId,
      projectId: id,
      phaseId: t.phaseId,
      title: t.title,
      category: t.category,
      complexity,
      role: t.role,
      originalEstimateH: estimate,
      timeSpentH: actual,
      labels,
      addedAfterKickoff,
      created: addedAfterKickoff ? addDays(startDate, 10 + rng() * 15) : startDate,
    };
  };

  planned.forEach((t, k) => projectItems.push(makeItem(t, false, k)));
  added.forEach((t, k) => projectItems.push(makeItem(t, true, planned.length + k)));

  // Plant two time-entry typos (an extra zero) in mid-history projects.
  if ((idx === 17 || idx === 29) && dataErrorsPlanted < 2) {
    const victim = projectItems.find((i) => !i.addedAfterKickoff && i.originalEstimateH >= 8 && i.originalEstimateH <= 20);
    if (victim) {
      victim.timeSpentH = half(victim.originalEstimateH * 10);
      dataErrorsPlanted++;
    }
  }

  const estimateH = projectItems.filter((i) => !i.addedAfterKickoff).reduce((s, i) => s + i.originalEstimateH, 0);
  const actualH = projectItems.reduce((s, i) => s + i.timeSpentH, 0);
  const size = sizeFromHours(estimateH);
  // Calendar length: phases mostly sequential; roughly total hours over squad capacity.
  // Calendar length: the engine's own schedule model run on the actual hours with the squad's team, plus
  // some noise, so durations in history are consistent with what the engine forecasts.
  const team: Partial<Record<Role, number>> = {};
  for (const m of squad.members) team[m.role] = m.count;
  const sched = scheduleOnce(
    {
      phases: PHASE_TEMPLATES[projectType].map((p) => ({ id: p.id, order: p.order })),
      items: projectItems.map((i) => ({ id: i.id, phaseId: i.phaseId, role: i.role, o: i.timeSpentH, m: i.timeSpentH, p: i.timeSpentH })),
      teamShape: team,
      squad: squad.stats,
      plannedLeave: [],
      startDate,
      runs: 1,
      seed: SEED,
    },
    projectItems.map((i) => (i.timeSpentH > i.originalEstimateH * 8 ? i.originalEstimateH : i.timeSpentH)),
  );
  const endDate = addWorkingDays(startDate, Math.max(5, sched.finish * Math.exp(0.08 * normal(durRng))));
  for (const it of projectItems) {
    it.resolved = addDays(endDate, -rng() * 5);
    it.labels.splice(1, 0, `size:${size}`);
  }
  projects.push({
    id,
    seedId: id,
    name: projectName,
    client,
    projectType,
    size,
    squad: squad.id,
    startDate,
    endDate,
    status: 'closed',
    estimateH: Math.round(estimateH * 10) / 10,
    actualH: Math.round(actualH * 10) / 10,
    labels: [`type:${projectType}`, `size:${size}`, `squad:${squad.id}`, `client:${slug(client)}`, `seed:${id}`, ...(leaveOverlap ? ['leave-overlap'] : [])],
  });
  items.push(...projectItems);
});

// --- the three open samples ------------------------------------------------------

const OPEN: { id: string; name: string; client: string; projectType: ProjectType; size: Size; squad: string }[] = [
  { id: 'S01', name: 'Harborlight Partners: reminders for unsigned investors', client: 'Harborlight Partners', projectType: 'new-feature', size: 'M', squad: 'alpha' },
  { id: 'S02', name: 'Oakmere Capital: subscription form online', client: 'Oakmere Capital', projectType: 'form-digitization', size: 'L', squad: 'beta' },
  { id: 'S03', name: 'Tidewell Fund III: fund administrator sync', client: 'Tidewell Fund III', projectType: 'integration', size: 'L', squad: 'gamma' },
];
for (const o of OPEN) {
  projects.push({
    ...o,
    seedId: o.id,
    startDate: '2026-10-26',
    endDate: '2026-12-31',
    status: 'open',
    estimateH: 0,
    actualH: 0,
    labels: [`type:${o.projectType}`, `size:${o.size}`, `squad:${o.squad}`, `client:${slug(o.client)}`, `seed:${o.id}`],
  });
}

// --- worklogs ------------------------------------------------------------------------

const worklogs: Worklog[] = [];
for (let week = addDays('2025-04-07', 0); week < '2026-10-12'; week = addDays(week, 7)) {
  for (const squad of squads) {
    for (const m of squad.members) {
      if (m.count === 0) continue;
      const plannedH = m.count * 40;
      // Each person-week: absent a whole week with small probability, else scattered days.
      let absence = 0;
      for (let p = 0; p < m.count; p++) {
        const u = rng();
        if (u < squad.stats.absenceRate * 0.35) absence += 40;
        else if (u < squad.stats.absenceRate * 2.7) absence += 8 * (1 + Math.floor(rng() * 2));
      }
      absence = Math.min(plannedH, absence);
      const loggedH = Math.round((plannedH - absence) * squad.stats.focusFactor * lognormal(0.05) * 2) / 2;
      worklogs.push({ squad: squad.id, weekStart: week, role: m.role, plannedH, loggedH, absenceH: absence });
    }
  }
}

const data: SeedData = {
  generatedWith: { seed: SEED, script: 'scripts/seed.ts', generatedAt: '2026-10-17' },
  squads,
  projects,
  items,
  worklogs,
};
SeedSchema.parse(data);

const out = join(DATA, 'seed');
writeJson(join(out, 'squads.json'), squads);
writeJson(join(out, 'projects.json'), projects);
writeJson(join(out, 'items.json'), items);
writeJson(join(out, 'worklogs.json'), worklogs);
writeJson(join(out, 'meta.json'), data.generatedWith);

const closed = projects.filter((p) => p.status === 'closed');
const ratio = (t: ProjectType) => {
  const ps = closed.filter((p) => p.projectType === t);
  return (ps.reduce((s, p) => s + p.actualH, 0) / ps.reduce((s, p) => s + p.estimateH, 0)).toFixed(2);
};
const absence = worklogs.reduce((s, w) => s + w.absenceH, 0) / worklogs.reduce((s, w) => s + w.plannedH, 0);
console.log(`seed ${SEED}: ${closed.length} closed projects, ${items.length} items, ${worklogs.length} worklog rows`);
console.log(`actual/estimate by type: ${(['new-feature', 'form-digitization', 'integration', 'data-migration', 'reporting'] as ProjectType[]).map((t) => `${t} ${ratio(t)}`).join(', ')}`);
console.log(`e-signature added in ${items.filter((i) => i.category === 'esign').length}/${closed.filter((p) => p.projectType === 'form-digitization').length} form projects; absence ${(absence * 100).toFixed(1)}%; data errors ${dataErrorsPlanted}`);
const catRatio = (c: Category) => {
  const xs = items.filter((i) => i.category === c && !i.addedAfterKickoff && i.timeSpentH < i.originalEstimateH * 8);
  return (xs.reduce((s, i) => s + i.timeSpentH, 0) / xs.reduce((s, i) => s + i.originalEstimateH, 0)).toFixed(2);
};
console.log(`actual/estimate by category: integration ${catRatio('integration')}, reporting ${catRatio('reporting')}, esign n/a (added), forms ${catRatio('forms')}`);
