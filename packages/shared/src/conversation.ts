import { z } from 'zod';
import { BriefPack, PanelResult, Provenance, Role, ScopeResult, TeamShape } from './domain';

/** The inputs of one estimate version. The engine is deterministic, so the numbers are recomputed from these. */
/** One adjustment to the timeline: a risk adds hours (h > 0), an opportunity takes them off (h < 0). `id` names a quick-pick. */
export const BufferRisk = z.object({ id: z.string().optional(), label: z.string(), h: z.number() });
export type BufferRisk = z.infer<typeof BufferRisk>;

/** The team's AI tooling: which kinds of tool, on which plan. It shrinks the hours of the work each kind touches. */
export const AiToolKind = z.enum(['coding', 'chat', 'testing', 'design']);
export type AiToolKind = z.infer<typeof AiToolKind>;
export const AiPlan = z.enum(['none', 'free', 'paid', 'enterprise']);
export type AiPlan = z.infer<typeof AiPlan>;
export const AiTools = z.partialRecord(AiToolKind, AiPlan);
export type AiTools = z.infer<typeof AiTools>;

export const EstimateSpec = z.object({
  team: TeamShape,
  answeredQuestionIds: z.array(z.string()),
  droppedItemIds: z.array(z.string()),
  startDate: z.string(),
  deadline: z.string().optional(),
  /** Working-hours policy for this estimate only; unset = the default (see state/policy.ts). */
  hoursPerDay: z.number().min(1).max(12).optional(),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
  /** AI tools the team works with, for this estimate only; unset = the saved default, else none. */
  aiTools: AiTools.optional(),
  /** Risks (+h) and opportunities (−h), plus a percentage margin for the unknown. They stretch or shorten the timeline; effort stays pure. */
  risks: z.array(BufferRisk).optional(),
  bufferPct: z.number().min(0).max(100).optional(),
  /** A needed role with nobody on the team, covered by another role ("Developer does it too"). */
  coveredRoles: z.partialRecord(Role, Role).optional(),
});
export type EstimateSpec = z.infer<typeof EstimateSpec>;

export const EstimateVersion = z.object({
  id: z.string(),
  createdAt: z.string(),
  spec: EstimateSpec,
  /** Cached headline so collapsed versions and the sidebar don't need a re-run. */
  summary: z.object({ weeksLow: z.number(), weeksHigh: z.number(), safeDate: z.string() }),
});
export type EstimateVersion = z.infer<typeof EstimateVersion>;

export const ProgressStep = z.object({ label: z.string(), state: z.enum(['done', 'active', 'todo']) });
export type ProgressStep = z.infer<typeof ProgressStep>;

const base = { id: z.string(), createdAt: z.string() };

export const Message = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('user_brief'),
    briefId: z.string(),
    preview: z.string(),
    files: z.array(z.object({ name: z.string(), label: z.string() })),
  }),
  z.object({ ...base, kind: z.literal('user_text'), text: z.string() }),
  z.object({ ...base, kind: z.literal('progress'), intro: z.string(), steps: z.array(ProgressStep) }),
  z.object({
    ...base,
    kind: z.literal('estimate'),
    estimateId: z.string(),
    changeNote: z.string().optional(),
    /** Earlier versions this message showed before an in-place edit replaced them (newest last). */
    edits: z.array(z.object({ estimateId: z.string(), changeNote: z.string().optional(), createdAt: z.string() })).optional(),
  }),
  z.object({
    ...base,
    kind: z.literal('comparison'),
    baseEstimateId: z.string(),
    proposedEstimateId: z.string(),
    proposedLabel: z.string(),
    summary: z.string(),
    /** true = used, false = kept the current one, undefined = not decided yet. */
    applied: z.boolean().optional(),
  }),
  z.object({ ...base, kind: z.literal('answer'), text: z.string(), sources: z.array(z.string()).optional() }),
  z.object({ ...base, kind: z.literal('error'), text: z.string(), retry: z.boolean() }),
]);
export type Message = z.infer<typeof Message>;
export type MessageKind = Message['kind'];

export const Conversation = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(['working', 'ready', 'error']),
  brief: BriefPack,
  /** Set when the conversation was started from a bundled sample. */
  sampleId: z.string().optional(),
  squadId: z.string(),
  scope: ScopeResult.optional(),
  scopeProvenance: Provenance.optional(),
  panel: PanelResult.optional(),
  panelProvenance: Provenance.optional(),
  messages: z.array(Message),
  versions: z.record(z.string(), EstimateVersion),
  currentEstimateId: z.string(),
  team: TeamShape,
  startDate: z.string(),
  clientDeadline: z.string().optional(),
});
export type Conversation = z.infer<typeof Conversation>;

export const ConversationStore = z.object({ version: z.literal(1), conversations: z.array(Conversation) });
export type ConversationStore = z.infer<typeof ConversationStore>;
