import { z } from 'zod';
import { Category, Explanation, Impact, Role } from './domain';
import { LessonCause } from './history';

export const Analog = z.object({
  historyItemId: z.string(),
  projectId: z.string(),
  title: z.string(),
  actualH: z.number(),
  estimateH: z.number(),
  similarity: z.number(),
});
export type Analog = z.infer<typeof Analog>;

export const ItemAnalogs = z.object({
  itemId: z.string(),
  matches: z.array(Analog),
});
export type ItemAnalogs = z.infer<typeof ItemAnalogs>;

export const ReferenceClass = z.object({
  n: z.number().int(),
  median: z.number(),
  p20: z.number(),
  p80: z.number(),
  projectIds: z.array(z.string()),
  /** True when exact type+size had too few matches and the size filter was relaxed. */
  relaxed: z.boolean(),
});
export type ReferenceClass = z.infer<typeof ReferenceClass>;

export const CalibratedItem = z.object({
  itemId: z.string(),
  phaseId: z.string(),
  role: Role,
  category: Category,
  panel: z.object({ o: z.number(), m: z.number(), p: z.number() }),
  blendWeight: z.number(),
  biasFactor: z.number(),
  /** Spread multiplier currently applied from open questions. */
  openSpread: z.number(),
  o: z.number(),
  m: z.number(),
  p: z.number(),
  p50: z.number(),
  p80: z.number(),
});
export type CalibratedItem = z.infer<typeof CalibratedItem>;

export const PhaseEstimate = z.object({
  phaseId: z.string(),
  name: z.string(),
  role: Role,
  order: z.number(),
  /** Effort hours. */
  p50: z.number(),
  p80: z.number(),
  /** Working-day offsets from project start (P50 schedule). */
  startDay: z.number(),
  endDayP50: z.number(),
  endDayP80: z.number(),
});
export type PhaseEstimate = z.infer<typeof PhaseEstimate>;

export const RankedQuestion = z.object({
  questionId: z.string(),
  question: z.string(),
  impact: Impact,
  /** Reduction in (P80 − P50) total hours if answered. */
  narrowsByH: z.number(),
  affectedItemIds: z.array(z.string()),
});
export type RankedQuestion = z.infer<typeof RankedQuestion>;

export const Histogram = z.object({
  /** Lower edge of each bin. */
  edges: z.array(z.number()),
  counts: z.array(z.number()),
  binWidth: z.number(),
});
export type Histogram = z.infer<typeof Histogram>;

export const Estimate = z.object({
  perPhase: z.array(PhaseEstimate),
  total: z.object({ p50: z.number(), p80: z.number(), p10: z.number(), p95: z.number() }),
  buffer: z.object({
    task: z.number(),
    missingInfo: z.number(),
    availability: z.number(),
    total: z.number(),
  }),
  /** Σ P50 + buffer, in hours. */
  commitHours: z.number(),
  startDate: z.string(),
  commitDate: z.string(),
  p50Date: z.string(),
  p80Date: z.string(),
  deadline: z.string().optional(),
  /** null when there's no deadline. */
  onTimeProbability: z.number().nullable(),
  confidence: z.enum(['High', 'Medium', 'Low']),
  rankedQuestions: z.array(RankedQuestion),
  analogs: z.array(ItemAnalogs),
  referenceClass: ReferenceClass,
  items: z.array(CalibratedItem),
  hoursHistogram: Histogram,
  finishDayHistogram: Histogram,
  runs: z.number().int(),
  seed: z.number().int(),
  elapsedMs: z.number(),
  explanations: z.record(z.string(), Explanation),
});
export type Estimate = z.infer<typeof Estimate>;

export const BacktestPoint = z.object({
  order: z.number().int(),
  projectId: z.string(),
  name: z.string(),
  actualH: z.number(),
  rawH: z.number(),
  calibratedP50: z.number(),
  calibratedP80: z.number(),
  rawMRE: z.number(),
  calibratedMRE: z.number(),
  rollingRawMMRE: z.number(),
  rollingCalibratedMMRE: z.number(),
  withinP80: z.boolean(),
});
export type BacktestPoint = z.infer<typeof BacktestPoint>;

export const AccuracyMetrics = z.object({
  n: z.number().int(),
  mmre: z.number(),
  pred25: z.number(),
  p80HitRate: z.number(),
});
export type AccuracyMetrics = z.infer<typeof AccuracyMetrics>;

export const MissFinding = z.object({
  scope: z.enum(['phase', 'item']),
  refId: z.string(),
  title: z.string(),
  estimateH: z.number(),
  actualH: z.number(),
  ratio: z.number(),
  cause: LessonCause,
  note: z.string(),
  suspectedDataError: z.boolean(),
});
export type MissFinding = z.infer<typeof MissFinding>;

export const PostmortemResult = z.object({
  projectId: z.string(),
  summary: z.string(),
  findings: z.array(MissFinding),
  lessons: z.array(
    z.object({
      cause: LessonCause,
      note: z.string(),
      appliesTo: z.object({ category: Category.optional(), projectType: z.string().optional() }),
    }),
  ),
});
export type PostmortemResult = z.infer<typeof PostmortemResult>;
