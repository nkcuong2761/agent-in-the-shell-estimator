import { z } from 'zod';

export const SourceKind = z.enum(['email', 'pdf', 'notes', 'transcript', 'jira']);
export type SourceKind = z.infer<typeof SourceKind>;

export const BriefSource = z.object({
  kind: SourceKind,
  name: z.string().min(1),
  text: z.string(),
});
export type BriefSource = z.infer<typeof BriefSource>;

export const BriefPack = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  clientDeadline: z.string().optional(),
  sources: z.array(BriefSource).min(1),
});
export type BriefPack = z.infer<typeof BriefPack>;

export const ProjectType = z.enum([
  'new-feature',
  'form-digitization',
  'integration',
  'data-migration',
  'reporting',
]);
export type ProjectType = z.infer<typeof ProjectType>;

export const Size = z.enum(['S', 'M', 'L', 'XL']);
export type Size = z.infer<typeof Size>;

export const Complexity = z.enum(['S', 'M', 'L']);
export type Complexity = z.infer<typeof Complexity>;

export const Role = z.enum(['pm', 'designer', 'engineer', 'qa', 'legal']);
export type Role = z.infer<typeof Role>;

export const ROLE_LABELS: Record<Role, string> = {
  pm: 'Product / delivery',
  designer: 'Design',
  engineer: 'Engineering',
  qa: 'QA',
  legal: 'Legal',
};

export const Category = z.enum([
  'discovery',
  'design',
  'frontend',
  'backend',
  'integration',
  'forms',
  'esign',
  'notifications',
  'data',
  'reporting',
  'qa',
  'devops',
  'legal',
]);
export type Category = z.infer<typeof Category>;

export const Phase = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().nonnegative(),
  role: Role,
});
export type Phase = z.infer<typeof Phase>;

const p = (id: string, name: string, order: number, role: Role): Phase => ({ id, name, order, role });

export const PHASE_TEMPLATES: Record<ProjectType, Phase[]> = {
  'new-feature': [
    p('discovery', 'Discovery', 0, 'pm'),
    p('design', 'Design', 1, 'designer'),
    p('build', 'Build', 2, 'engineer'),
    p('qa', 'QA', 3, 'qa'),
    p('go-live', 'Go-live', 4, 'engineer'),
  ],
  'form-digitization': [
    p('form-analysis', 'Form analysis', 0, 'pm'),
    p('legal-review', 'Legal review', 1, 'legal'),
    p('build-form', 'Build form', 2, 'engineer'),
    p('integration', 'Integration', 3, 'engineer'),
    p('qa', 'QA', 4, 'qa'),
    p('go-live', 'Go-live', 5, 'engineer'),
  ],
  integration: [
    p('discovery', 'Discovery', 0, 'pm'),
    p('api-mapping', 'API mapping', 1, 'engineer'),
    p('build', 'Build', 2, 'engineer'),
    p('integration-testing', 'Integration testing', 3, 'qa'),
    p('go-live', 'Go-live', 4, 'engineer'),
  ],
  'data-migration': [
    p('discovery', 'Discovery', 0, 'pm'),
    p('mapping', 'Data mapping', 1, 'engineer'),
    p('build', 'Build scripts', 2, 'engineer'),
    p('trial-migration', 'Trial migration', 3, 'qa'),
    p('go-live', 'Cutover', 4, 'engineer'),
  ],
  reporting: [
    p('discovery', 'Discovery', 0, 'pm'),
    p('design', 'Report design', 1, 'designer'),
    p('build', 'Build', 2, 'engineer'),
    p('qa', 'QA', 3, 'qa'),
    p('go-live', 'Go-live', 4, 'engineer'),
  ],
};

export const SourceRef = z.object({
  source: z.string().min(1),
  quote: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const WorkItem = z.object({
  id: z.string().min(1),
  phaseId: z.string().min(1),
  title: z.string().min(1),
  category: Category,
  complexity: Complexity,
  role: Role,
  o: z.number().nonnegative(),
  m: z.number().nonnegative(),
  p: z.number().nonnegative(),
  sourceRefs: z.array(SourceRef),
  affectedByQuestions: z.array(z.string()),
});
export type WorkItem = z.infer<typeof WorkItem>;

export const Impact = z.enum(['high', 'medium', 'low']);
export type Impact = z.infer<typeof Impact>;

export const MissingInfo = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  why: z.string(),
  affectedItemIds: z.array(z.string()),
  /** Factor by which the affected items' (p − o) spread widens while the question is open. ≥ 1. */
  spreadMultiplier: z.number().min(1).max(4),
  impact: Impact.default('medium'),
});
export type MissingInfo = z.infer<typeof MissingInfo>;

export const ScopeRisk = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  likelihood: z.number().min(0).max(1),
  evidenceProjectIds: z.array(z.string()),
  addedHoursRange: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
  clientQuestion: z.string().optional(),
});
export type ScopeRisk = z.infer<typeof ScopeRisk>;

export const ScopeResult = z.object({
  projectType: ProjectType,
  size: Size,
  /** A 4–6 word conversation title, e.g. "Put the subscription form online". */
  title: z.string().default(''),
  summary: z.string().default(''),
  phases: z.array(Phase).min(1),
  items: z.array(WorkItem).min(1),
  assumptions: z.array(z.string()),
  outOfScope: z.array(z.string()),
  missingInfo: z.array(MissingInfo),
  scopeRisks: z.array(ScopeRisk),
  clientEmailDraft: z.string(),
});
export type ScopeResult = z.infer<typeof ScopeResult>;

export const Persona = z.enum(['delivery-lead', 'qa-lead', 'domain-expert']);
export type Persona = z.infer<typeof Persona>;

export const PERSONA_LABELS: Record<Persona, string> = {
  'delivery-lead': 'Delivery lead',
  'qa-lead': 'QA lead',
  'domain-expert': 'Domain expert',
};

export const PanelGuess = z.object({
  itemId: z.string().min(1),
  o: z.number().nonnegative(),
  m: z.number().nonnegative(),
  p: z.number().nonnegative(),
  reason: z.string(),
});
export type PanelGuess = z.infer<typeof PanelGuess>;

export const PanelAgent = z.object({
  persona: Persona,
  items: z.array(PanelGuess),
});
export type PanelAgent = z.infer<typeof PanelAgent>;

export const PanelResult = z.object({
  agents: z.array(PanelAgent).length(3),
  /** Round-1 guesses are kept so the UI can show how much the panel converged. */
  round1: z.array(PanelAgent).optional(),
  rounds: z.literal(2),
  disagreementFlags: z.array(z.string()),
});
export type PanelResult = z.infer<typeof PanelResult>;

export const TeamShape = z.partialRecord(Role, z.number().int().min(0).max(20));
export type TeamShape = z.infer<typeof TeamShape>;

export const SquadStats = z.object({
  focusFactor: z.number().min(0.1).max(1),
  absenceRate: z.number().min(0).max(0.5),
  coordinationOverheadPerExtra: z.number().min(0).max(0.5),
});
export type SquadStats = z.infer<typeof SquadStats>;

export const Explanation = z.object({
  method: z.string(),
  citation: z.string(),
  plainWords: z.string(),
  formula: z.string().optional(),
  inputs: z.record(z.string(), z.union([z.number(), z.string()])),
});
export type Explanation = z.infer<typeof Explanation>;

export const Provenance = z.object({
  promptVersion: z.string(),
  generatedBy: z.enum(['claude', 'fixture', 'offline-heuristic']),
  model: z.string().optional(),
  generatedAt: z.string(),
});
export type Provenance = z.infer<typeof Provenance>;
