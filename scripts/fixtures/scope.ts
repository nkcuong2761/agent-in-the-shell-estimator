/**
 * Hand-written scope fixtures for the three samples, used when no ANTHROPIC_API_KEY is available.
 * They follow the scope agent's contract (prompts/scope.md): every item cites a source, unknowns go to
 * missingInfo, and nothing is invented about the client. `npm run precompute -- --live` replaces them with real
 * Claude output.
 */
import type { Category, Complexity, MissingInfo, Phase, ProjectType, Role, ScopeResult, Size, WorkItem } from '@scopewise/shared';
import { PHASE_TEMPLATES } from '@scopewise/shared';

export const SCOPE_FIXTURE_VERSION = 'fixture-scope@1';

type Ref = [source: 'email.md' | 'meeting-notes.md' | 'jira-ticket.md', quote?: string];

function item(
  id: string,
  phaseId: string,
  title: string,
  category: Category,
  complexity: Complexity,
  role: Role,
  [o, m, p]: [number, number, number],
  refs: Ref[],
  questions: string[] = [],
): WorkItem {
  return {
    id,
    phaseId,
    title,
    category,
    complexity,
    role,
    o,
    m,
    p,
    sourceRefs: refs.map(([source, quote]) => (quote ? { source, quote } : { source })),
    affectedByQuestions: questions,
  };
}

function link(items: WorkItem[], missing: Omit<MissingInfo, 'affectedItemIds'>[]): MissingInfo[] {
  return missing.map((q) => ({ ...q, affectedItemIds: items.filter((i) => i.affectedByQuestions.includes(q.id)).map((i) => i.id) }));
}

function scope(
  projectType: ProjectType,
  size: Size,
  summary: string,
  items: WorkItem[],
  missing: Omit<MissingInfo, 'affectedItemIds'>[],
  rest: Pick<ScopeResult, 'assumptions' | 'outOfScope' | 'clientEmailDraft'>,
): ScopeResult {
  const used = new Set(items.map((i) => i.phaseId));
  const phases: Phase[] = PHASE_TEMPLATES[projectType].filter((p) => used.has(p.id));
  return { projectType, size, summary, phases, items, missingInfo: link(items, missing), scopeRisks: [], ...rest };
}

// --- 1. investor reminders ---------------------------------------------------------------

const remindersItems: WorkItem[] = [
  item('rem-d1', 'discovery', 'Confirm reminder rules, channels and compliance limits', 'discovery', 'M', 'pm', [6, 10, 16], [['meeting-notes.md', 'Dana wasn’t sure whether compliance would allow SMS']], ['q-channels']),
  item('rem-d2', 'discovery', 'User stories and acceptance criteria', 'discovery', 'S', 'pm', [4, 6, 10], [['jira-ticket.md']]),
  item('rem-ds1', 'design', 'Schedule and pause controls for IR', 'design', 'M', 'designer', [10, 14, 22], [['jira-ticket.md', 'IR can pause or resume reminders per investor and per closing']], ['q-cadence']),
  item('rem-ds2', 'design', 'Branded reminder email templates', 'design', 'S', 'designer', [6, 8, 14], [['email.md', 'use our branding and come from the fund’s address']], ['q-legal']),
  item('rem-ds3', 'design', 'Outstanding-signatures view', 'design', 'S', 'designer', [4, 6, 12], [['meeting-notes.md', 'a simple view of “who’s outstanding”']]),
  item('rem-b1', 'build', 'Reminder scheduler with escalation and quiet hours', 'notifications', 'L', 'engineer', [24, 32, 52], [['email.md', 'more insistent as the closing date approaches'], ['meeting-notes.md', 'Reminders shouldn’t go out at 3am']], ['q-channels', 'q-cadence']),
  item('rem-b2', 'build', 'Signature status for joint and entity investors', 'backend', 'M', 'engineer', [12, 18, 34], [['meeting-notes.md', 'only one of several people has signed']], ['q-partial']),
  item('rem-b3', 'build', 'Pause and resume per investor and per closing', 'backend', 'M', 'engineer', [8, 12, 20], [['jira-ticket.md', 'AC 3']]),
  item('rem-b4', 'build', 'Branded sender address and email delivery', 'notifications', 'M', 'engineer', [8, 12, 22], [['email.md', 'come from the fund’s address, not a no-reply']], ['q-channels']),
  item('rem-b5', 'build', 'Reminder log and IR activity view', 'frontend', 'M', 'engineer', [12, 18, 28], [['jira-ticket.md', 'Every reminder sent is logged and visible to IR']]),
  item('rem-b6', 'build', 'Reminder schedule settings screen', 'frontend', 'M', 'engineer', [10, 16, 26], [['meeting-notes.md', 'adjustable per closing']], ['q-cadence']),
  item('rem-b7', 'build', 'Opt-out handling', 'backend', 'S', 'engineer', [4, 6, 12], [['meeting-notes.md', 'Unsubscribe / opt-out: not discussed']], ['q-optout']),
  item('rem-q1', 'qa', 'Test plan: schedules, time zones and pausing', 'qa', 'M', 'qa', [10, 14, 24], [['meeting-notes.md', 'investors are in the US, UK and Singapore']], ['q-channels']),
  item('rem-q2', 'qa', 'Email client rendering checks', 'qa', 'S', 'qa', [4, 6, 10], [['email.md']]),
  item('rem-g1', 'go-live', 'Release behind a flag, monitoring and IR walkthrough', 'devops', 'S', 'engineer', [4, 6, 10], [['jira-ticket.md']], ['q-legal']),
];

export const remindersScope = scope(
  'new-feature',
  'M',
  'Automatic, escalating reminders to investors who haven’t signed their subscription documents, with IR controls to pause and a log of what was sent.',
  remindersItems,
  [
    { id: 'q-channels', question: 'Can reminders go by SMS as well as email, or email only?', why: 'SMS adds a second delivery channel, consent rules and testing; the call left it open pending compliance.', spreadMultiplier: 1.8, impact: 'high' },
    { id: 'q-cadence', question: 'Will IR set the reminder schedule per closing themselves, or is one default schedule enough?', why: 'A self-service schedule needs a settings screen and validation; a fixed default does not.', spreadMultiplier: 1.6, impact: 'high' },
    { id: 'q-partial', question: 'When only some signatories of a joint or entity investor have signed, should the others keep getting reminders?', why: 'Changes how signature status is read and who receives each reminder.', spreadMultiplier: 1.5, impact: 'medium' },
    { id: 'q-optout', question: 'Do investors need a way to opt out of reminders, and does compliance require one?', why: 'Not discussed on the call; an opt-out needs storage, a link in every email and handling in the scheduler.', spreadMultiplier: 1.5, impact: 'medium' },
    { id: 'q-legal', question: 'How long does your legal sign-off on email templates usually take?', why: 'Template approval sits on the path to go-live.', spreadMultiplier: 1.3, impact: 'low' },
  ],
  {
    assumptions: [
      'Documents are already sent and signed through the platform, so signature status is available without new integrations.',
      'Harborlight provides logo, colours and template copy.',
      'About 300–400 investors per closing, 3–4 closings a year.',
      'Reminders are sent in each investor’s local business hours.',
    ],
    outOfScope: [
      'Routing investor replies to the right IR person (marked nice to have; can be quoted separately).',
      'Weekly board summary (mentioned, not committed).',
    ],
    clientEmailDraft:
      'Hi Dana,\n\nThanks for the time on the kickoff call. Below is our first estimate for automated reminders to unsigned investors. A few answers from your side would narrow it considerably. They are listed in the order that helps the estimate most:\n\n{{questions}}\n\nOnce we have these, we’ll send a firm plan and a commit date against your December 11 close.\n\nBest regards,\nThe delivery team',
  },
);

// --- 2. subscription form ------------------------------------------------------------------

const formItems: WorkItem[] = [
  item('sub-fa1', 'form-analysis', 'Field inventory of the 22-page v7 form', 'forms', 'M', 'pm', [10, 14, 22], [['email.md', '22-page paper form'], ['meeting-notes.md', '~140 fields']]),
  item('sub-fa2', 'form-analysis', 'Conditional logic map for branching sections', 'forms', 'M', 'pm', [8, 12, 20], [['meeting-notes.md', '30% of fields are conditional']], ['q-variants']),
  item('sub-lr1', 'legal-review', 'Counsel review of disclosures and consent wording', 'legal', 'M', 'legal', [10, 14, 26], [['meeting-notes.md', 'needs to review every disclosure and consent sentence']], ['q-signature']),
  item('sub-bf1', 'build-form', 'Multi-step form with investor, tax, accreditation, funds and bank sections', 'forms', 'L', 'engineer', [28, 40, 64], [['email.md', 'sections for investor details, tax status, accreditation, source of funds and bank details']], ['q-variants', 'q-signature', 'q-docs']),
  item('sub-bf2', 'build-form', 'Field validation and conditional sections', 'forms', 'M', 'engineer', [16, 22, 36], [['email.md', 'can’t submit with missing or inconsistent answers']], ['q-variants']),
  item('sub-bf3', 'build-form', 'Save and resume draft', 'frontend', 'M', 'engineer', [10, 14, 22], [['meeting-notes.md', 'definitely needed, it’s a long form']]),
  item('sub-bf4', 'build-form', 'PDF of the completed submission', 'backend', 'M', 'engineer', [12, 16, 26], [['email.md', 'A PDF copy of what they submitted']], ['q-signature']),
  item('sub-bf5', 'build-form', 'Bank details capture with masking', 'forms', 'S', 'engineer', [6, 8, 14], [['email.md', 'bank details']]),
  item('sub-bf6', 'build-form', 'Accessible form patterns: keyboard, screen readers, large text', 'frontend', 'M', 'engineer', [8, 12, 22], [['meeting-notes.md', 'some older investors struggle with web forms']], ['q-a11y']),
  item('sub-in1', 'integration', 'Map form fields to investor records', 'integration', 'M', 'engineer', [12, 18, 30], [['email.md', 'going straight into our investor records']], ['q-records']),
  item('sub-in2', 'integration', 'Write submissions to the investor database', 'integration', 'L', 'engineer', [16, 24, 44], [['meeting-notes.md', 'whether it has an API']], ['q-records']),
  item('sub-qa1', 'qa', 'Form QA across branches and edge cases', 'qa', 'M', 'qa', [14, 20, 32], [['meeting-notes.md']], ['q-variants', 'q-docs']),
  item('sub-qa2', 'qa', 'Accessibility check', 'qa', 'S', 'qa', [6, 8, 14], [['meeting-notes.md']], ['q-a11y']),
  item('sub-gl1', 'go-live', 'Launch and paper-to-online cutover plan', 'devops', 'S', 'engineer', [6, 8, 12], [['jira-ticket.md']]),
];

export const formScope = scope(
  'form-digitization',
  'L',
  'Replace the 22-page paper subscription agreement with an online form that validates answers, saves drafts, produces a PDF and writes to investor records.',
  formItems,
  [
    { id: 'q-signature', question: 'How will investors sign at launch: an e-signature inside the form, or print and sign the PDF?', why: '“We can figure out signatures later” leaves the biggest piece of work undecided; counsel looked unconvinced.', spreadMultiplier: 2.0, impact: 'high' },
    { id: 'q-variants', question: 'How many form variants are there: individual, entity, and trust?', why: 'Each variant multiplies branches to build and test.', spreadMultiplier: 1.8, impact: 'high' },
    { id: 'q-records', question: 'Does the investor database have an API we can write to, and who owns it?', why: 'Writing directly is very different from a file export or a manual import.', spreadMultiplier: 1.8, impact: 'high' },
    { id: 'q-docs', question: 'Should supporting documents (ID, W-9/W-8) be uploaded through the form?', why: 'Uploads add storage, virus scanning and review screens.', spreadMultiplier: 1.4, impact: 'medium' },
    { id: 'q-a11y', question: 'Is there an accessibility standard you need to meet, for example WCAG 2.1 AA?', why: 'Sets how much accessibility work and testing is needed.', spreadMultiplier: 1.3, impact: 'low' },
  ],
  {
    assumptions: [
      'Fields and wording follow Subscription Agreement v7.',
      'Counsel’s review runs in parallel with form analysis, but holidays may slow it.',
      'Investors use a modern desktop or mobile browser.',
    ],
    outOfScope: ['Migrating past paper submissions into the new form.', 'Investor identity verification (KYC checks).'],
    clientEmailDraft:
      'Hi Priya,\n\nThank you for walking us through Subscription Agreement v7. Here is our first estimate for the online form. These questions affect the estimate most, in order of how much each answer would narrow it:\n\n{{questions}}\n\nWith answers we can firm up the plan for the January 29 close.\n\nKind regards,\nThe delivery team',
  },
);

// --- 3. fund admin sync --------------------------------------------------------------------

const syncItems: WorkItem[] = [
  item('fas-d1', 'discovery', 'Confirm Northgate integration option and contract scope', 'discovery', 'M', 'pm', [6, 10, 18], [['meeting-notes.md', 'REST API for “some clients” and nightly SFTP CSV files for others']], ['q-transport']),
  item('fas-d2', 'discovery', 'Agree sync direction and source-of-truth rules', 'discovery', 'S', 'pm', [4, 8, 14], [['meeting-notes.md', 'Not settled']], ['q-direction', 'q-truth']),
  item('fas-am1', 'api-mapping', 'Field mapping: names, entities, addresses, commitments, bank details', 'integration', 'M', 'engineer', [12, 18, 30], [['email.md', 'investor names, entities, addresses, commitment amounts, and bank details']]),
  item('fas-am2', 'api-mapping', 'Investor ID matching and duplicate handling', 'integration', 'L', 'engineer', [14, 22, 40], [['meeting-notes.md', 'Some investors are duplicated on Northgate’s side']]),
  item('fas-b1', 'build', 'Northgate connector: API client or SFTP file ingestion', 'integration', 'M', 'engineer', [12, 20, 36], [['meeting-notes.md']], ['q-transport']),
  item('fas-b2', 'build', 'Daily sync job with retries', 'integration', 'L', 'engineer', [20, 30, 48], [['jira-ticket.md', 'within one business day']], ['q-transport']),
  item('fas-b3', 'build', 'Outbound updates to Northgate', 'integration', 'M', 'engineer', [12, 18, 32], [['email.md', 'the other side should reflect it']], ['q-direction']),
  item('fas-b4', 'build', 'Conflict handling rules', 'integration', 'M', 'engineer', [10, 16, 30], [['meeting-notes.md', 'nobody knew which should win']], ['q-truth']),
  item('fas-b5', 'build', 'Approval queue for bank detail changes', 'backend', 'M', 'engineer', [10, 14, 24], [['jira-ticket.md', 'Bank detail changes require human approval']]),
  item('fas-b6', 'build', 'Failure alerts and change log page', 'backend', 'M', 'engineer', [8, 12, 20], [['jira-ticket.md', 'Sync failures alert the ops team']]),
  item('fas-it1', 'integration-testing', 'End-to-end tests against the Northgate sandbox', 'qa', 'M', 'qa', [12, 18, 32], [['meeting-notes.md', 'access needs a separate request']], ['q-sandbox', 'q-direction']),
  item('fas-it2', 'integration-testing', 'Reconciliation run on ~1,200 investors', 'qa', 'M', 'qa', [8, 12, 20], [['meeting-notes.md', '~1,200 investors']], ['q-backfill']),
  item('fas-gl1', 'go-live', 'Production cutover and first full sync', 'devops', 'M', 'engineer', [6, 10, 18], [['email.md']], ['q-backfill']),
];

export const syncScope = scope(
  'integration',
  'L',
  'Keep investor records in sync between the platform and Northgate Fund Services, with alerts, a change log and human approval for bank details.',
  syncItems,
  [
    { id: 'q-direction', question: 'Should the sync run one way (Northgate to the platform) or both ways?', why: 'The email says both ways; the call mostly described a one-way pull. Two-way roughly doubles the build and testing.', spreadMultiplier: 2.0, impact: 'high' },
    { id: 'q-transport', question: 'Does Tidewell’s Northgate contract include the REST API, or only nightly SFTP files?', why: 'Decides the connector design and how fresh the data can be.', spreadMultiplier: 1.8, impact: 'high' },
    { id: 'q-sandbox', question: 'Can you request Northgate sandbox access this week? It usually takes two weeks.', why: 'Without a sandbox, integration testing can’t start.', spreadMultiplier: 1.6, impact: 'high' },
    { id: 'q-truth', question: 'When the same field changes on both sides, which system should win?', why: 'Conflict rules decide how much reconciliation logic is needed.', spreadMultiplier: 1.5, impact: 'medium' },
    { id: 'q-backfill', question: 'Should the first run reconcile all ~1,200 existing records, or only new changes?', why: 'A full backfill adds a reconciliation pass and clean-up of known duplicates.', spreadMultiplier: 1.5, impact: 'medium' },
  ],
  {
    assumptions: [
      'About 1,200 investors with tens of changes per week.',
      'Northgate will share integration documentation before build starts.',
      'Bank detail changes are applied only after a person approves them.',
    ],
    outOfScope: ['Cleaning up duplicate investors on Northgate’s side (Northgate is doing this).', 'Syncing documents or capital account statements.'],
    clientEmailDraft:
      'Hi Leo,\n\nThanks for setting up the call with Aiko. Here is our first estimate for the Northgate sync. These questions matter most to the estimate and the December 18 date, in order of impact:\n\n{{questions}}\n\nThe sandbox request in particular can run in the background while we start discovery.\n\nBest,\nThe delivery team',
  },
);

export const SCOPE_FIXTURES: Record<string, ScopeResult> = {
  'investor-reminders': remindersScope,
  'subscription-form': formScope,
  'fund-admin-sync': syncScope,
};
