import { z } from 'zod';
import { BriefPack, PanelResult, Provenance, ScopeResult, TeamShape } from './domain';

/** The inputs of one estimate version. The engine is deterministic, so the numbers are recomputed from these. */
export const EstimateSpec = z.object({
  team: TeamShape,
  answeredQuestionIds: z.array(z.string()),
  droppedItemIds: z.array(z.string()),
  startDate: z.string(),
  deadline: z.string().optional(),
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
  z.object({ ...base, kind: z.literal('estimate'), estimateId: z.string(), changeNote: z.string().optional() }),
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
