// ── Projects ─────────────────────────────────────────────────────────────────

export const VALID_PROJECT_STATUSES = ["active", "paused", "done"] as const;
export type ProjectStatus = (typeof VALID_PROJECT_STATUSES)[number];

// ── PRD status transitions ────────────────────────────────────────────────────

export const VALID_PRD_STATUSES = ["draft", "ready", "in_progress", "done", "canceled"] as const;
export type PrdStatus = (typeof VALID_PRD_STATUSES)[number];

export const VALID_PRD_TRANSITIONS: Record<PrdStatus, PrdStatus[]> = {
  draft: ["ready", "canceled"],
  ready: ["in_progress", "canceled"],
  in_progress: ["done", "canceled"],
  done: [],
  canceled: [],
};

// ── Task status transitions ───────────────────────────────────────────────────

export const VALID_TASK_STATUSES = [
  "pending",
  "in_progress",
  "blocked",
  "done",
  "skipped",
] as const;
export type TaskStatus = (typeof VALID_TASK_STATUSES)[number];

export const VALID_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress", "skipped"],
  in_progress: ["done", "blocked"],
  blocked: ["in_progress", "skipped"],
  done: [],
  skipped: [],
};

export const VALID_TASK_DESCRIPTION_FORMATS = ["structured_v1", "plain"] as const;
export type TaskDescriptionFormat = (typeof VALID_TASK_DESCRIPTION_FORMATS)[number];

// ── Effort ───────────────────────────────────────────────────────────────────

export const VALID_EFFORTS = ["xs", "s", "m", "l", "xl"] as const;
export type Effort = (typeof VALID_EFFORTS)[number];

// ── Event types ──────────────────────────────────────────────────────────────

export const VALID_EVENT_TYPES = [
  "session_start",
  "task_started",
  "task_done",
  "task_blocked",
  "task_skipped",
  "prd_activated",
  "prd_ready",
  "prd_done",
  "prd_canceled",
  "note",
  "error",
] as const;

export type EventType = (typeof VALID_EVENT_TYPES)[number];
