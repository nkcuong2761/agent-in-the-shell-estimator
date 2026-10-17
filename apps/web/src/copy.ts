/**
 * Every user-facing phrase on the main screens lives here, in plain language.
 * Technical terms (P50, P80, buffer, calibration, …) appear only in the methods drawer, after a plain sentence.
 * See the glossary in CLAUDE.md ("User journey v2").
 */
import type { Category, Role } from '@scopewise/shared';

export const copy = {
  product: 'Scopewise',
  newEstimate: 'New estimate',
  recent: 'Recent estimates',
  finished: 'Finished — how did we do?',
  howWorkedOut: 'How estimates are worked out',
  sampleData: 'Sample data',
  showAll: (n: number) => `Show all ${n}`,
  showFewer: 'Show fewer',
  menu: 'Menu',

  askHeading: "What's the brief you'd like me to estimate?",
  askSub: "Paste the client's email or notes, or drop in files. I'll tell you how long it should take, and what to ask the client first.",
  pastePlaceholder: 'Paste the brief here…',
  dropHere: 'Drop emails, PDFs or meeting notes here',
  attach: 'Attach files',
  addJira: 'Add a Jira link',
  jiraPlaceholder: 'Jira issue key or link, e.g. SUB-142',
  estimateButton: 'Estimate',
  tryExample: 'No brief to hand? Try an example:',
  demoNeedsApi: 'Live estimates need the API. Try an example to see how it works.',
  liveNoClaude: "The API is running but has no Claude key yet, so it can't read new briefs. Try an example to see how it works.",

  workingIntro: "Got it. I'm reading everything and comparing it with past projects.",
  stepRead: (n: number) => `Read ${n} document${n === 1 ? '' : 's'}`,
  stepReading: (n: number) => `Reading ${n} document${n === 1 ? '' : 's'}`,
  stepSplit: (n: number) => `Split the work into ${n} stage${n === 1 ? '' : 's'}`,
  stepSplitting: 'Splitting the work into stages',
  stepCompare: (n: number) => `Comparing with ${n} similar past project${n === 1 ? '' : 's'}…`,
  stepCompared: (n: number) => `Compared with ${n} similar past project${n === 1 ? '' : 's'}`,
  stepTimeline: 'Working out the timeline and a safe date to promise',
  followUpLocked: 'You can ask follow-up questions once the estimate is ready.',
  followUpPlaceholder: 'Ask a follow-up, or add something the client said…',
  send: 'Send',

  hereIsEstimate: (summary: string) => `Here's my estimate for ${summary}`,
  takesAbout: 'This will take about',
  plannedFor: (team: string) => `Planned for ${team}`,
  changeTeam: 'change the team',
  mostLikely: 'Most likely finished',
  safeDate: 'Safe date to promise the client',
  includesMargin: (m: string) => `Includes about ${m} of safety margin`,
  howSure: 'How sure am I?',
  sure: { High: 'Very sure', Medium: 'Fairly sure', Low: 'Not sure yet' } as const,
  couldMove: (n: number, amount: string) => `${n} open question${n === 1 ? '' : 's'} could still move this by up to ${amount}.`,
  noneOpen: 'No open questions left. What remains is ordinary day-to-day uncertainty.',

  whatWhen: 'What happens when',
  weeksFromKickoff: 'Weeks from kickoff',
  runsLong: 'often runs long',
  marginRow: 'Safety margin',
  marginRowNote: 'for surprises',
  itemHours: (lo: number, hi: number) => (lo === hi ? `about ${lo} hours` : `about ${lo}–${hi} hours`),
  showItems: (n: number) => `Show ${n} piece${n === 1 ? '' : 's'} of work`,

  askClient: 'Ask the client before you commit',
  askClientSub: 'Most important first. Their answers make the estimate tighter.',
  saveGuesswork: (amount: string) => `Asking now could save up to ${amount} of guesswork.`,
  copyEmail: 'Copy email to client',
  copied: 'Email copied. Paste it into your mail app.',
  copyFailed: "Couldn't reach the clipboard. Select the email text below and copy it.",
  knowAnswers: 'I already know the answers',
  answerPlaceholder: 'What did the client say?',
  submitAnswers: 'Use these answers',
  cancel: 'Cancel',

  why: 'Why this number?',
  fullWorking: 'See the full working and methods',

  sendToJira: 'Send to Jira',
  needsApi: 'Needs the API',
  share: 'Share',
  linkCopied: 'Link copied',
  sentToJira: (key: string) => `Sent to Jira as ${key}.`,

  updated: (range: string, was: string, because: string) =>
    range === was || !was ? `Updated: still ${range} because ${because}, with less guesswork in the margin.` : `Updated: now ${range} (was ${was}) because ${because}.`,
  earlierVersion: (range: string, safe: string) => `Earlier estimate: ${range}, safe date ${safe}`,
  showVersion: 'Show',
  hideVersion: 'Hide',

  useThis: 'Use this',
  keepCurrent: 'Keep the current one',
  usedThis: 'Using this one now.',
  keptCurrent: 'Kept the current estimate.',
  current: 'Current',
  rowTakes: 'Takes about',
  rowLikely: 'Most likely finished',
  rowSafe: 'Safe date to promise',
  rowTeamTime: 'Total team time',

  demoOther: 'In this demo I can answer questions about team size, deadlines, dropping parts of the work, or why a stage takes long.',
  retry: 'Try again',
  readOnly: 'Read-only view. Switch to the Manager view on "How estimates are worked out" to make changes.',

  projectFinished: (date: string) => `Finished ${date}`,
  howDidItDo: 'How did the estimate do?',
  weSaid: (range: string, took: string) => `We said ${range}. It took ${took}.`,
  onTime: (range: string) => `We said ${range}. It finished on time.`,
  estimated: 'Estimated',
  actual: 'Actual',
  fromJira: 'Actual hours come straight from Jira, so nobody has to fill anything in.',
  whatHappened: 'What happened',
  whatLearned: 'What I learned',
  ruleAdded: 'I now add this question to every similar brief automatically.',
  gettingBetter: 'Are the estimates getting better?',
  gettingBetterSub: 'How far off was each estimate? One bar per finished project, oldest first.',
  improvement: (early: number, late: number) => `Early estimates were off by about ${early}%. The last five were off by about ${late}%.`,
  thisProject: 'This project',
  sideTook: (took: string, said: string) => `Took ${took} · we said ${said}`,
  sideOnTime: (said: string) => `On time · we said ${said}`,
  notFound: "I couldn't find that conversation. It may have been on another device.",
  backToNew: 'Start a new estimate',
} as const;

const ROLE_WORDS: Record<Role, [string, string]> = {
  pm: ['product lead', 'product leads'],
  designer: ['designer', 'designers'],
  engineer: ['developer', 'developers'],
  qa: ['tester', 'testers'],
  legal: ['legal reviewer', 'legal reviewers'],
};

export function roleWord(role: Role, n = 1): string {
  return ROLE_WORDS[role][n === 1 ? 0 : 1];
}

/** Words people use for each role, for the follow-up parser. */
export const ROLE_SYNONYMS: Record<Role, string[]> = {
  engineer: ['developer', 'developers', 'dev', 'devs', 'engineer', 'engineers', 'programmer', 'programmers', 'coder'],
  designer: ['designer', 'designers', 'ux', 'ui designer'],
  qa: ['tester', 'testers', 'qa', 'quality'],
  pm: ['product lead', 'product manager', 'pm', 'project manager', 'delivery lead', 'analyst', 'ba'],
  legal: ['legal', 'lawyer', 'lawyers', 'counsel', 'legal reviewer'],
};

/** Plain names for kinds of work, used in "We usually underestimate … work". */
export const CATEGORY_WORDS: Record<Category, string> = {
  discovery: 'working out the requirements',
  design: 'design',
  frontend: 'building screens',
  backend: 'back-end',
  integration: 'connect to another system',
  forms: 'form building',
  esign: 'e-signing',
  notifications: 'reminders and notifications',
  data: 'moving data',
  reporting: 'reporting',
  qa: 'testing',
  devops: 'release',
  legal: 'legal review',
};

export const SOURCE_LABELS = {
  email: 'Client email',
  notes: 'Kickoff call notes',
  transcript: 'Call transcript',
  pdf: 'PDF',
  jira: 'Jira ticket',
} as const;

/** Terms that must never appear on the main screens (checked by a test). */
export const BANNED_TERMS = ['P50', 'P80', 'MMRE', 'PRED', 'PERT', 'Monte Carlo', 'buffer', 'calibrat', 'FTE'];
