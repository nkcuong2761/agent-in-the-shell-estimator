import { z } from 'zod';
import { BriefPack, PanelResult, Provenance, ScopeResult, TeamShape } from './domain';
import { Lesson } from './history';
import { PostmortemResult } from './estimate';

export const HealthResponse = z.object({
  ok: z.literal(true),
  version: z.string(),
  features: z.object({
    claude: z.boolean(),
    jira: z.boolean(),
    database: z.boolean(),
  }),
  model: z.string().optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ScopeRequest = z.object({ brief: BriefPack });
export const ScopeResponse = z.object({ scope: ScopeResult, provenance: Provenance, brief: BriefPack.optional() });
export type ScopeResponse = z.infer<typeof ScopeResponse>;

export const PanelRequest = z.object({ brief: BriefPack, scope: ScopeResult });
export const PanelResponse = z.object({ panel: PanelResult, provenance: Provenance });
export type PanelResponse = z.infer<typeof PanelResponse>;

export const EstimateRequest = z.object({
  scope: ScopeResult,
  panel: PanelResult.optional(),
  teamShape: TeamShape,
  squadId: z.string().optional(),
  startDate: z.string(),
  deadline: z.string().optional(),
  answeredQuestionIds: z.array(z.string()).default([]),
  droppedItemIds: z.array(z.string()).default([]),
  runs: z.number().int().min(100).max(20000).optional(),
});
export type EstimateRequest = z.infer<typeof EstimateRequest>;

export const ChatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const AskRequest = z.object({
  messages: z.array(ChatMessage).min(1).max(30),
  context: EstimateRequest.optional(),
});
export const AskResponse = z.object({
  answer: z.string(),
  toolCalls: z.array(z.object({ name: z.string(), input: z.unknown(), summary: z.string() })),
  provenance: Provenance,
});
export type AskResponse = z.infer<typeof AskResponse>;

export const PostmortemRequest = z.object({ projectId: z.string() });
export const PostmortemResponse = z.object({ result: PostmortemResult, provenance: Provenance });
export type PostmortemResponse = z.infer<typeof PostmortemResponse>;

export const JiraPushRequest = z.object({
  title: z.string(),
  summary: z.string(),
  estimateUrl: z.string().optional(),
  projectType: z.string(),
  size: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      phaseId: z.string(),
      category: z.string(),
      p50Hours: z.number(),
      p80Hours: z.number(),
    }),
  ),
  dryRun: z.boolean().default(false),
});
export type JiraPushRequest = z.infer<typeof JiraPushRequest>;

export const JiraPushResponse = z.object({
  epicKey: z.string().nullable(),
  storyKeys: z.array(z.string()),
  dryRun: z.boolean(),
  plan: z.array(z.string()),
});
export type JiraPushResponse = z.infer<typeof JiraPushResponse>;

export const LessonsResponse = z.object({ lessons: z.array(Lesson) });

export const AskScriptEntry = z.object({
  question: z.string(),
  answer: z.string(),
  toolCalls: z.array(z.object({ name: z.string(), summary: z.string() })).default([]),
});
export type AskScriptEntry = z.infer<typeof AskScriptEntry>;

export const DemoCacheEntry = z.object({
  briefId: z.string(),
  scope: ScopeResult,
  scopeProvenance: Provenance,
  panel: PanelResult,
  panelProvenance: Provenance,
  ask: z.array(AskScriptEntry),
});
export type DemoCacheEntry = z.infer<typeof DemoCacheEntry>;

export const DemoPostmortems = z.object({
  provenance: Provenance,
  results: z.array(PostmortemResult),
});
export type DemoPostmortems = z.infer<typeof DemoPostmortems>;
