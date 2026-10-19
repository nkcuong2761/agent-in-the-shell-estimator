import type { BriefPack, Category, Complexity, HistoryItem, HistoryProject, Impact, MissingInfo, ProjectType, Role, ScopeResult, Size, WorkItem } from '@scopewise/shared';
import { PHASE_TEMPLATES, ProjectType as ProjectTypeSchema } from '@scopewise/shared';
import { predictScopeRisks, templateRiskQuestion } from './scopeRisk';
import { round } from './stats';

/**
 * Deterministic stand-in for the Claude scope agent, used when the API has no Anthropic key (or no credit) and
 * in the browser when there is no API at all. Rules only, no model:
 *  - the project type is the template whose keywords the brief mentions most;
 *  - the work items are that type's standard breakdown, plus add-ons for features the brief names
 *    (e-signature, reminders, PDF, exports, bank details, …), each citing the sentence that triggered it;
 *  - size follows how many of those signals the brief carries and how long it is;
 *  - open questions are the type's usual unknowns, dropped when the brief already answers them.
 * Hours are the template's base hours scaled by size; the panel, analogs and bias correction refine them.
 * Outputs are labelled `offline-heuristic` wherever they appear.
 */
export const OFFLINE_SCOPE_VERSION = 'offline-heuristic-scope@1';

const TYPE_SIGNALS: Record<ProjectType, RegExp[]> = {
  'form-digitization': [/\bforms?\b/, /\bpaper\b/, /\bfields?\b/, /questionnaire/, /digiti[sz]/, /fill(ed|ing)? (in|out)/, /\bsubscription (form|agreement|document)/, /online version/],
  integration: [/\bsync(h|ed|ing)?\b/, /integrat/, /\bapi\b/, /webhook/, /\bconnect(ed|ion|or)?\b/, /administrator/, /third[- ]party/, /two systems/, /reconcil/, /\bfeed\b/],
  'data-migration': [/migrat/, /\bimport(ed|ing)?\b/, /legacy/, /move (the |our )?(data|records)/, /cutover/, /spreadsheets?/, /old system/, /historical (data|records)/],
  reporting: [/\breports?\b/, /reporting/, /dashboard/, /\bcharts?\b/, /statements?/, /metrics/, /\bkpis?\b/, /analytics/, /figures/],
  'new-feature': [/feature/, /remind/, /notif/, /workflow/, /portal/, /screen/, /button/, /\bemails?\b/, /\bflow\b/],
};

type Phase = Record<ProjectType, string>;
/** Where each add-on lands: the "build" phase of every template. */
const BUILD_PHASE: Phase = { 'new-feature': 'build', 'form-digitization': 'build-form', integration: 'build', 'data-migration': 'build', reporting: 'build' };

interface ItemTemplate {
  phase: string;
  title: string;
  category: Category;
  complexity: Complexity;
  hours: number;
  /** What in the brief this item answers to; the first matching sentence becomes its quote. */
  keywords?: RegExp;
}

const SIZE_FACTOR: Record<Size, number> = { S: 0.75, M: 1, L: 1.35, XL: 1.8 };

const TEMPLATES: Record<ProjectType, ItemTemplate[]> = {
  'new-feature': [
    { phase: 'discovery', title: 'Clarify the rules and the flow with the client', category: 'discovery', complexity: 'M', hours: 10, keywords: /rule|when|who|should/ },
    { phase: 'discovery', title: 'Write acceptance criteria', category: 'discovery', complexity: 'S', hours: 6 },
    { phase: 'design', title: 'Screens and wording for the new flow', category: 'design', complexity: 'M', hours: 14, keywords: /screen|page|wording|template|copy/ },
    { phase: 'build', title: 'Rules and data changes behind the feature', category: 'backend', complexity: 'M', hours: 24, keywords: /track|record|status|rule/ },
    { phase: 'build', title: 'User-facing screens', category: 'frontend', complexity: 'M', hours: 20, keywords: /screen|page|see|view|portal/ },
    { phase: 'qa', title: 'Test plan and test runs', category: 'qa', complexity: 'M', hours: 14 },
    { phase: 'qa', title: 'Fix round after testing', category: 'qa', complexity: 'S', hours: 8 },
    { phase: 'go-live', title: 'Release, monitoring and handover', category: 'devops', complexity: 'S', hours: 6, keywords: /go[- ]live|launch|release|roll ?out/ },
  ],
  'form-digitization': [
    { phase: 'form-analysis', title: 'Field inventory of the paper form', category: 'forms', complexity: 'M', hours: 12, keywords: /page|field|section/ },
    { phase: 'form-analysis', title: 'Map of conditional sections and validation rules', category: 'forms', complexity: 'M', hours: 10, keywords: /conditional|depend|if the|validat|mandatory|required/ },
    { phase: 'legal-review', title: 'Counsel review of disclosures and consent wording', category: 'legal', complexity: 'M', hours: 12, keywords: /legal|counsel|disclosure|consent|wording/ },
    { phase: 'build-form', title: 'Multi-step online form', category: 'forms', complexity: 'L', hours: 36, keywords: /form|section|step/ },
    { phase: 'build-form', title: 'Field validation and conditional sections', category: 'forms', complexity: 'M', hours: 20, keywords: /validat|inconsistent|missing|conditional|required/ },
    { phase: 'build-form', title: 'Save and resume a draft', category: 'frontend', complexity: 'S', hours: 10, keywords: /save|resume|draft|come back/ },
    { phase: 'integration', title: 'Write submissions to the records', category: 'integration', complexity: 'M', hours: 18, keywords: /record|crm|system|database|profile/ },
    { phase: 'qa', title: 'Test every path through the form', category: 'qa', complexity: 'M', hours: 16 },
    { phase: 'go-live', title: 'Release and handover', category: 'devops', complexity: 'S', hours: 6, keywords: /go[- ]live|launch|release|roll ?out/ },
  ],
  integration: [
    { phase: 'discovery', title: 'Agree which records and fields sync, and which side wins', category: 'discovery', complexity: 'M', hours: 12, keywords: /field|record|names?|address|amount|detail/ },
    { phase: 'api-mapping', title: "Read the partner's API documentation and map the fields", category: 'integration', complexity: 'M', hours: 16, keywords: /documentation|api|docs|spec/ },
    { phase: 'api-mapping', title: 'Access and authentication with the partner', category: 'integration', complexity: 'S', hours: 8, keywords: /access|credential|token|auth|account/ },
    { phase: 'build', title: 'Outbound sync: send changes to the partner', category: 'integration', complexity: 'L', hours: 30, keywords: /send|push|update them|their side|the other side/ },
    { phase: 'build', title: 'Inbound sync: receive changes from the partner', category: 'integration', complexity: 'L', hours: 30, keywords: /receive|pull|from them|their (register|system)|changes on/ },
    { phase: 'build', title: 'Conflict handling, retries and error reporting', category: 'backend', complexity: 'M', hours: 18, keywords: /conflict|drift|mismatch|fail|error|retry/ },
    { phase: 'integration-testing', title: "End-to-end tests against the partner's test environment", category: 'qa', complexity: 'M', hours: 18, keywords: /test|sandbox|staging/ },
    { phase: 'go-live', title: 'First reconciliation and cutover', category: 'data', complexity: 'M', hours: 12, keywords: /reconcil|go[- ]live|cutover|launch/ },
  ],
  'data-migration': [
    { phase: 'discovery', title: 'Inventory of the source data and its owners', category: 'discovery', complexity: 'M', hours: 10, keywords: /source|spreadsheet|legacy|old system|export/ },
    { phase: 'mapping', title: 'Field mapping and transformation rules', category: 'data', complexity: 'M', hours: 16, keywords: /field|map|format|column/ },
    { phase: 'mapping', title: 'Data quality review of the source', category: 'data', complexity: 'M', hours: 12, keywords: /clean|duplicate|quality|wrong|missing/ },
    { phase: 'build', title: 'Migration scripts', category: 'data', complexity: 'L', hours: 30, keywords: /migrat|import|move|load/ },
    { phase: 'build', title: 'Validation and reconciliation reports', category: 'reporting', complexity: 'M', hours: 12, keywords: /check|verify|reconcil|count|match/ },
    { phase: 'trial-migration', title: 'Trial run and fixes', category: 'qa', complexity: 'M', hours: 16, keywords: /trial|dry run|rehears|test/ },
    { phase: 'trial-migration', title: 'Client sign-off on sample records', category: 'qa', complexity: 'S', hours: 6, keywords: /sign[- ]off|approve|review/ },
    { phase: 'go-live', title: 'Cutover and freeze window', category: 'devops', complexity: 'M', hours: 10, keywords: /cutover|freeze|weekend|go[- ]live|switch/ },
  ],
  reporting: [
    { phase: 'discovery', title: 'Agree the questions the report must answer', category: 'discovery', complexity: 'M', hours: 8, keywords: /question|answer|need to (see|know)|want to/ },
    { phase: 'design', title: 'Report layout and charts', category: 'design', complexity: 'M', hours: 12, keywords: /chart|graph|layout|table|dashboard/ },
    { phase: 'build', title: 'Data queries and aggregation', category: 'data', complexity: 'M', hours: 20, keywords: /total|sum|per|by (fund|investor|month|quarter)|aggregate/ },
    { phase: 'build', title: 'Report screens and filters', category: 'frontend', complexity: 'M', hours: 18, keywords: /filter|screen|page|view|dashboard/ },
    { phase: 'build', title: 'Export to PDF or spreadsheet', category: 'reporting', complexity: 'S', hours: 10, keywords: /export|pdf|excel|csv|download/ },
    { phase: 'qa', title: 'Check the figures against known totals', category: 'qa', complexity: 'M', hours: 12, keywords: /accura|correct|match|reconcil/ },
    { phase: 'qa', title: 'Fix round after testing', category: 'qa', complexity: 'S', hours: 6 },
    { phase: 'go-live', title: 'Release and handover', category: 'devops', complexity: 'S', hours: 6, keywords: /go[- ]live|launch|release/ },
  ],
};

/** Features a brief can name on top of the standard breakdown. `not` skips the add-on for types that cover it already. */
const ADDONS: (ItemTemplate & { id: string; keywords: RegExp; not?: ProjectType[] })[] = [
  { id: 'esign', phase: '', title: 'E-signature step', category: 'esign', complexity: 'M', hours: 16, keywords: /e-?sign|signature|docusign|sign(ed|ing)? (it|the|this|electronically)/ },
  { id: 'notify', phase: '', title: 'Sending reminders and notifications', category: 'notifications', complexity: 'M', hours: 16, keywords: /remind|notif|\bsms\b|text message|alert/ },
  { id: 'pdf', phase: '', title: 'PDF copy of the completed record', category: 'backend', complexity: 'M', hours: 12, keywords: /\bpdf\b/ },
  { id: 'report', phase: '', title: 'Reporting view of the results', category: 'reporting', complexity: 'M', hours: 14, keywords: /\breports?\b|dashboard/, not: ['reporting'] },
  { id: 'files', phase: '', title: 'Import and export of data files', category: 'data', complexity: 'M', hours: 12, keywords: /\bcsv\b|spreadsheet|excel|bulk (import|export)|(import|export)(ed|ing)? (a |the )?(list|file|data)/, not: ['data-migration', 'reporting'] },
  { id: 'bank', phase: '', title: 'Secure handling of bank and payment details', category: 'backend', complexity: 'M', hours: 12, keywords: /bank (details|account)|payment|\biban\b|wire/ },
  { id: 'upload', phase: '', title: 'Document upload and storage', category: 'backend', complexity: 'M', hours: 12, keywords: /upload|attach(ment)?|supporting document|proof of/ },
  { id: 'audit', phase: '', title: 'Audit trail of who changed what', category: 'backend', complexity: 'S', hours: 8, keywords: /audit|history of|log of|who changed/ },
  { id: 'access', phase: '', title: 'Access rules and permissions', category: 'backend', complexity: 'M', hours: 12, keywords: /\bsso\b|single sign-on|log ?in|permission|role-based|who can see/ },
  { id: 'settings', phase: '', title: 'Settings so the client can change it themselves', category: 'frontend', complexity: 'M', hours: 12, keywords: /configur|settings (page|screen)|cadence|frequency|without (us|a developer)/ },
];

interface QuestionTemplate {
  id: string;
  question: string;
  why: string;
  /** Items in these categories widen while the question is open. Empty = every item. */
  categories: Category[];
  spread: number;
  impact: Impact;
  /** Only asked when the brief does not already say. */
  answeredIf?: RegExp;
  /** Only asked when the brief mentions this. */
  onlyIf?: RegExp;
  types?: ProjectType[];
}

const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\b\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{4}-\d{2}-\d{2}|\b(year[- ]end|quarter[- ]end|end of (the )?(year|quarter|month))\b/i;

const QUESTIONS: QuestionTemplate[] = [
  { id: 'q-deadline', question: "What date does this need to be live, and what's driving that date?", why: 'Without a date I cannot say whether the plan is safe or where to cut.', categories: [], spread: 1.25, impact: 'medium', answeredIf: MONTH },
  { id: 'q-users', question: 'Who uses this day to day, and roughly how many people or records are involved?', why: 'Volume decides how much the screens and the data handling need to cope with.', categories: ['frontend', 'design', 'data'], spread: 1.3, impact: 'low', answeredIf: /\b\d[\d,]*\s*(users|investors|people|staff|records|entries|lps\b)/i },
  { id: 'q-systems', question: 'Which existing systems or investor records must this read from or write to (CRM, database, API)?', why: 'Every connection to another system is work and a place where things go wrong.', categories: ['integration', 'backend', 'data'], spread: 1.5, impact: 'high', types: ['new-feature', 'form-digitization', 'reporting'] },
  // form-digitization
  { id: 'q-signature', question: 'Does the online form need an e-signature, or is a submitted form enough?', why: 'An e-signature step adds a legal review and a signing flow.', categories: ['esign', 'forms', 'legal'], spread: 1.6, impact: 'high', types: ['form-digitization'] },
  { id: 'q-variants', question: 'Is there one form for every investor type, or different versions for an individual, an entity and a trust?', why: 'Each variant multiplies the fields, the rules and the testing.', categories: ['forms'], spread: 1.5, impact: 'high', types: ['form-digitization'] },
  { id: 'q-docs', question: 'Which supporting documents must be uploaded with the form (passport, W-9), and who checks them?', why: 'Uploads need storage, virus checks and a review step.', categories: ['forms', 'backend'], spread: 1.4, impact: 'medium', types: ['form-digitization'] },
  // integration
  { id: 'q-transport', question: "How does the partner expose the data: an API, SFTP file drops, CSV exports, or something else?", why: 'A file drop and an API are different builds; until we know, the mapping and build are guesses.', categories: ['integration'], spread: 1.8, impact: 'high', types: ['integration'] },
  { id: 'q-direction', question: 'Is the sync one-way or two-way, and which side is the source of truth when both change the same record?', why: 'Two-way sync with conflicts is roughly twice the work of one-way.', categories: ['integration', 'backend'], spread: 1.5, impact: 'high', types: ['integration'] },
  { id: 'q-sandbox', question: 'Do we get a sandbox or test environment from the partner, and when?', why: 'Without a test environment, integration testing waits for the partner.', categories: ['integration', 'qa'], spread: 1.4, impact: 'medium', types: ['integration'] },
  { id: 'q-backfill', question: 'Do existing records need a one-off backfill of historical data before the sync starts?', why: 'A backfill is a small migration on top of the sync.', categories: ['data', 'integration'], spread: 1.3, impact: 'medium', types: ['integration'] },
  // new-feature
  { id: 'q-rules', question: 'What are the exact rules and cadence: who is included, when it triggers, how often, and can the client configure it?', why: 'The rules are most of the backend work and most of the testing.', categories: ['backend', 'discovery', 'frontend'], spread: 1.5, impact: 'high', types: ['new-feature'] },
  { id: 'q-channels', question: 'Which channels: email only, or also SMS or in-app?', why: 'Each channel is its own sending, tracking and opt-out work.', categories: ['notifications', 'backend'], spread: 1.4, impact: 'medium', onlyIf: /remind|notif|message|email/i, types: ['new-feature'] },
  { id: 'q-partial', question: 'What counts as done when there are several signers: a partial signature, a co-signer still missing, a countersignature?', why: 'Partly signed documents decide who gets chased and who does not.', categories: ['backend', 'esign'], spread: 1.4, impact: 'medium', onlyIf: /sign/i, types: ['new-feature'] },
  { id: 'q-optout', question: 'Can people opt out or be excluded, and is consent needed?', why: 'Exclusions and consent change the data model and the wording.', categories: ['notifications', 'legal'], spread: 1.3, impact: 'low', onlyIf: /remind|notif|message|email/i, types: ['new-feature'] },
  // data-migration
  { id: 'q-source', question: 'What format is the source data in (CSV, spreadsheet, database export), and who owns it?', why: 'Spreadsheets, exports and old databases each need different tooling.', categories: ['data', 'discovery'], spread: 1.6, impact: 'high', types: ['data-migration'] },
  { id: 'q-cleanup', question: 'How clean is the source data, and who fixes bad or duplicate records?', why: 'Data clean-up is the part of migrations that most often runs long.', categories: ['data', 'qa'], spread: 1.5, impact: 'high', types: ['data-migration'] },
  { id: 'q-cutover', question: 'Is there a freeze window for the cutover, and can we rehearse it?', why: 'A rehearsal and a freeze window are the difference between a weekend and a month.', categories: ['devops', 'qa'], spread: 1.3, impact: 'medium', types: ['data-migration'] },
  // reporting
  { id: 'q-figures', question: 'Exactly which figures and filters must the report show?', why: 'Each figure is a query to write and a number to check.', categories: ['data', 'frontend', 'design'], spread: 1.6, impact: 'high', types: ['reporting'] },
  { id: 'q-data-source', question: 'Where does each figure come from, and is that data already in the system?', why: 'Figures that live elsewhere need an import before any report can show them.', categories: ['data', 'integration'], spread: 1.5, impact: 'high', types: ['reporting'] },
  { id: 'q-export', question: 'Does it need PDF or spreadsheet export, or is on-screen enough?', why: 'Exports double the layout work.', categories: ['reporting'], spread: 1.2, impact: 'low', answeredIf: /export|\bpdf\b|excel|csv|download|print/i, types: ['reporting'] },
];

const ASSUMPTIONS: Record<ProjectType, string[]> = {
  'new-feature': ['The feature lives inside the existing product; no new log-in or portal.', 'The client provides the wording for any messages or screens.', 'Existing data is enough; no new data sources.'],
  'form-digitization': ['One form in one language.', 'The paper form is the final version; changes to it restart the field inventory.', 'The client provides a sample of completed forms for testing.'],
  integration: ['The partner provides API documentation and a test environment.', 'Records match on one agreed identifier.', 'Changes sync within the day; real time is not required.'],
  'data-migration': ['The client owns the source data and can export it.', 'One trial migration before the real one.', 'The old system stays read-only after cutover.'],
  reporting: ['All figures already exist in the system.', 'One report with a fixed layout and a handful of filters.', 'Figures are checked against totals the client already trusts.'],
};

const OUT_OF_SCOPE: Record<ProjectType, string[]> = {
  'new-feature': ['Changes to other systems than the ones named in the brief.', 'Translations.'],
  'form-digitization': ['Migrating forms already submitted on paper.', 'Changes to the records system itself.'],
  integration: ["Changes to the partner's system.", 'Syncing records not named in the brief.'],
  'data-migration': ['Clean-up of data the client decides to leave behind.', 'Changes to the target system.'],
  reporting: ['New data capture to feed the report.', 'Scheduled email delivery of the report.'],
};

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;

function sentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((s) => s.replace(/^[#>*\-\s]+/, '').trim())
    .filter((s) => s.length > 12 && !/^(from|to|cc|subject|date):/i.test(s));
}

/** The first sentence of any source that matches, as a citation. Falls back to the longest source, no quote. */
function cite(brief: BriefPack, re: RegExp | undefined): { source: string; quote?: string }[] {
  if (re) {
    for (const s of brief.sources) {
      const hit = sentences(s.text).find((line) => re.test(line));
      if (hit) return [{ source: s.name, quote: hit.length > 140 ? `${hit.slice(0, 137).replace(/\s+\S*$/, '')}…` : hit }];
    }
  }
  const longest = [...brief.sources].sort((a, b) => b.text.length - a.text.length)[0];
  return [{ source: longest?.name ?? brief.sources[0]?.name ?? 'brief' }];
}

export function detectProjectType(text: string): { type: ProjectType; scores: Record<ProjectType, number> } {
  const lower = text.toLowerCase();
  const scores = Object.fromEntries(ProjectTypeSchema.options.map((t) => [t, 0])) as Record<ProjectType, number>;
  for (const t of ProjectTypeSchema.options) {
    for (const re of TYPE_SIGNALS[t]) {
      const n = lower.match(new RegExp(re.source, 'g'))?.length ?? 0;
      scores[t] += Math.min(n, 4);
    }
  }
  // new-feature is the catch-all: another type wins only with a clear margin.
  const ranked = ProjectTypeSchema.options.filter((t) => t !== 'new-feature').sort((a, b) => scores[b] - scores[a]);
  const best = ranked[0] as ProjectType;
  const type = scores[best] >= 3 && scores[best] >= scores['new-feature'] * 0.6 ? best : 'new-feature';
  return { type, scores };
}

function titleFrom(brief: BriefPack): string {
  const clean = (s: string) => s.replace(/^(re|fwd?|fw):\s*/i, '').trim();
  for (const s of brief.sources) {
    const jira = s.text.match(/^#\s*[A-Z][A-Z0-9]+-\d+:\s*(.+)$/m)?.[1];
    if (jira) return clean(jira);
    const subject = s.text.match(/^subject:\s*(.+)$/im)?.[1];
    if (subject) return clean(subject);
  }
  if (brief.title && brief.title !== 'New brief') return brief.title;
  const first = sentences(brief.sources.map((s) => s.text).join('\n'))[0] ?? 'New estimate';
  const words = first.replace(/[.!?]+$/, '').split(/\s+/);
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : words.join(' ');
}

function summaryFrom(brief: BriefPack): string {
  const pick = brief.sources.find((s) => s.kind === 'email') ?? brief.sources.find((s) => s.kind === 'jira') ?? [...brief.sources].sort((a, b) => b.text.length - a.text.length)[0];
  const lines = sentences(pick?.text ?? '').filter((s) => !/^(hi|hello|dear|thanks|regards|best|attendees|kickoff|call with|discovery call|#)\b/i.test(s) && !/^[A-Z][A-Z0-9]+-\d+:/.test(s));
  const out = lines.slice(0, 2).join(' ');
  return out.length > 260 ? `${out.slice(0, 257).replace(/\s+\S*$/, '')}…` : out;
}

function sizeFrom(signals: number, words: number): Size {
  const score = signals + Math.min(2, Math.floor(words / 400));
  return score <= 1 ? 'S' : score <= 3 ? 'M' : score <= 6 ? 'L' : 'XL';
}

function hoursFor(base: number, size: Size): { o: number; m: number; p: number } {
  const m = round(base * SIZE_FACTOR[size], 0);
  return { o: round(m * 0.7, 0), m, p: round(m * 1.6, 0) };
}

export interface OfflineScopeHistory {
  projects: readonly HistoryProject[];
  items: readonly HistoryItem[];
}

export function offlineScope(brief: BriefPack, history: OfflineScopeHistory = { projects: [], items: [] }): ScopeResult {
  const text = brief.sources.map((s) => s.text).join('\n\n');
  const { type } = detectProjectType(text);
  const phases = PHASE_TEMPLATES[type];
  const roleOf = new Map(phases.map((p) => [p.id, p.role]));
  const prefix = type.slice(0, 3);

  const addons = ADDONS.filter((a) => !a.not?.includes(type) && a.keywords.test(text));
  const words = text.split(/\s+/).filter(Boolean).length;
  const size = sizeFrom(addons.length, words);

  const items: WorkItem[] = [];
  let n = 0;
  const push = (t: ItemTemplate, phase: string) => {
    n += 1;
    items.push({
      id: `${prefix}-${n}`,
      phaseId: phase,
      title: t.title,
      category: t.category,
      complexity: t.complexity,
      role: roleOf.get(phase) as Role,
      ...hoursFor(t.hours, size),
      sourceRefs: cite(brief, t.keywords),
      affectedByQuestions: [],
    });
  };
  for (const t of TEMPLATES[type]) push(t, t.phase);
  for (const a of addons) push(a, BUILD_PHASE[type]);

  const missingInfo: MissingInfo[] = QUESTIONS.filter((q) => (!q.types || q.types.includes(type)) && (!q.onlyIf || q.onlyIf.test(text)) && !(q.answeredIf && q.answeredIf.test(text)))
    .sort((a, b) => ['high', 'medium', 'low'].indexOf(a.impact) - ['high', 'medium', 'low'].indexOf(b.impact))
    .slice(0, 5)
    .map((q) => {
      const affected = items.filter((i) => q.categories.length === 0 || q.categories.includes(i.category)).map((i) => i.id);
      return { id: q.id, question: q.question, why: q.why, affectedItemIds: affected, spreadMultiplier: q.spread, impact: q.impact };
    });
  for (const q of missingInfo) for (const it of items) if (q.affectedItemIds.includes(it.id)) it.affectedByQuestions.push(q.id);

  const scopeRisks = predictScopeRisks(history.projects, history.items, type).map((r) => ({ ...r, clientQuestion: templateRiskQuestion(r) }));
  const used = new Set(items.map((i) => i.phaseId));
  const title = titleFrom(brief);

  return {
    projectType: type,
    size,
    title,
    summary: summaryFrom(brief),
    phases: phases.filter((p) => used.has(p.id)),
    items,
    assumptions: ASSUMPTIONS[type],
    outOfScope: OUT_OF_SCOPE[type],
    missingInfo,
    scopeRisks,
    clientEmailDraft: [
      `Subject: ${title}: a few questions before we commit`,
      '',
      'Hi,',
      '',
      "Thanks for the brief. Before we commit to a date, a few things would tighten the estimate a lot:",
      '',
      '{{questions}}',
      '',
      'Once we have these we can confirm the plan and the date.',
      '',
      'Best regards',
    ].join('\n'),
  };
}
