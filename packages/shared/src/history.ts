import { z } from 'zod';
import { Category, Complexity, ProjectType, Role, Size, SquadStats } from './domain';

export const SquadMember = z.object({ role: Role, count: z.number().int().min(0) });

export const PlannedLeave = z.object({
  role: Role,
  start: z.string(),
  end: z.string(),
  /** People in this role who are out for the window. */
  people: z.number().int().min(1),
  note: z.string(),
});
export type PlannedLeave = z.infer<typeof PlannedLeave>;

export const Squad = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(SquadMember),
  stats: SquadStats,
  plannedLeave: z.array(PlannedLeave),
});
export type Squad = z.infer<typeof Squad>;

export const HistoryProject = z.object({
  id: z.string(),
  seedId: z.string(),
  name: z.string(),
  client: z.string(),
  projectType: ProjectType,
  size: Size,
  squad: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(['closed', 'open']),
  /** Sum of the raw panel estimates (original estimates) for the project. */
  estimateH: z.number(),
  /** Sum of time spent. */
  actualH: z.number(),
  labels: z.array(z.string()),
  jiraKey: z.string().optional(),
});
export type HistoryProject = z.infer<typeof HistoryProject>;

export const HistoryItem = z.object({
  id: z.string(),
  seedId: z.string(),
  projectId: z.string(),
  phaseId: z.string(),
  title: z.string(),
  category: Category,
  complexity: Complexity,
  role: Role,
  originalEstimateH: z.number().nonnegative(),
  timeSpentH: z.number().nonnegative(),
  labels: z.array(z.string()),
  addedAfterKickoff: z.boolean(),
  created: z.string(),
  resolved: z.string().optional(),
  jiraKey: z.string().optional(),
});
export type HistoryItem = z.infer<typeof HistoryItem>;

export const Worklog = z.object({
  squad: z.string(),
  weekStart: z.string(),
  role: Role,
  plannedH: z.number().nonnegative(),
  loggedH: z.number().nonnegative(),
  absenceH: z.number().nonnegative(),
});
export type Worklog = z.infer<typeof Worklog>;

export const LessonCause = z.enum(['scope-added', 'underestimated', 'blocked', 'availability', 'data-error']);
export type LessonCause = z.infer<typeof LessonCause>;

export const Lesson = z.object({
  id: z.string().optional(),
  projectId: z.string(),
  cause: LessonCause,
  note: z.string(),
  appliesTo: z.object({ category: Category.optional(), projectType: ProjectType.optional() }),
  createdAt: z.string().optional(),
  source: z.enum(['seed', 'postmortem', 'user']).optional(),
});
export type Lesson = z.infer<typeof Lesson>;

export const SeedData = z.object({
  generatedWith: z.object({ seed: z.number(), script: z.string(), generatedAt: z.string() }),
  squads: z.array(Squad),
  projects: z.array(HistoryProject),
  items: z.array(HistoryItem),
  worklogs: z.array(Worklog),
});
export type SeedData = z.infer<typeof SeedData>;

export const TimesheetRow = z.object({
  date: z.string(),
  squad: z.string(),
  role: Role,
  hours: z.number().nonnegative(),
});
export type TimesheetRow = z.infer<typeof TimesheetRow>;
