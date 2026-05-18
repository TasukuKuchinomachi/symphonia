export const TASK_STATUS = [
  "BACKLOG",
  "PLANNING",
  "AWAITING_APPROVAL",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
  "FAILED",
] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export const GRAIN_STATUS = [
  "PENDING",
  "READY",
  "RUNNING",
  "VERIFYING",
  "MERGED",
  "FAILED",
  "SKIPPED",
] as const;
export type GrainStatus = (typeof GRAIN_STATUS)[number];

export const AGENT_KIND = ["PLAN", "IMPLEMENT", "REVIEW"] as const;
export type AgentKind = (typeof AGENT_KIND)[number];

export const RUN_STATUS = ["RUNNING", "SUCCESS", "FAILED", "CANCELLED"] as const;
export type RunStatus = (typeof RUN_STATUS)[number];

export const KANBAN_LANES: { id: TaskStatus; label: string; tone: string }[] = [
  { id: "BACKLOG", label: "Backlog", tone: "bg-ink-700" },
  { id: "PLANNING", label: "Planning", tone: "bg-amber-900/40" },
  { id: "AWAITING_APPROVAL", label: "Awaiting Approval", tone: "bg-amber-700/40" },
  { id: "IN_PROGRESS", label: "In Progress", tone: "bg-accent-600/30" },
  { id: "REVIEW", label: "Review", tone: "bg-blue-900/40" },
  { id: "DONE", label: "Done", tone: "bg-emerald-900/40" },
];

export const FAILED_LANE = { id: "FAILED" as const, label: "Failed", tone: "bg-red-900/40" };

export type PlanResult = {
  grains: Array<{
    title: string;
    instruction: string;
    files: string[];
    dependsOn: number[]; // indices within this list
  }>;
  notes?: string;
};

export type ReviewResult = {
  verdict: "APPROVE" | "REQUEST_CHANGES";
  summary: string;
  followUps?: Array<{ title: string; instruction: string; files: string[] }>;
};
