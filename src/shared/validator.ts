// ── Projects ─────────────────────────────────────────────────────────────────

export const VALID_PROJECT_STATUSES = ["active", "paused", "done"] as const;
export type ProjectStatus = (typeof VALID_PROJECT_STATUSES)[number];

// ── PRD status transitions ────────────────────────────────────────────────────

export const VALID_PRD_STATUSES = [
  "draft",
  "ready",
  "in_progress",
  "review",
  "done",
  "canceled",
] as const;
export type PrdStatus = (typeof VALID_PRD_STATUSES)[number];

// `review` marks the explicit "blocked by human" gate that sits between
// agent work and final approval. The orchestrator opens it after every
// coder+audit cycle so the kanban surfaces "waiting on human" as a
// first-class state. From `review` the human can either approve straight
// to `done`, or feedback flips the PRD back to `in_progress` so the dev
// orchestrator can spawn the next coder pass.
// `in_progress → done` is intentionally NOT allowed: the human-validation
// gate (`review`) must be crossed before any PRD can ship. The dev
// orchestrator opens the gate via `depot prd request-review`, and only the
// user's approval (via `depot prd done` on a review-state PRD) marks it done.
export const VALID_PRD_TRANSITIONS: Record<PrdStatus, PrdStatus[]> = {
  draft: ["ready", "canceled"],
  ready: ["in_progress", "canceled"],
  in_progress: ["review", "canceled"],
  review: ["in_progress", "done", "canceled"],
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

// ── Reviews ──────────────────────────────────────────────────────────────────

export const VALID_REVIEW_TYPES = ["human", "agent"] as const;
export type ReviewType = (typeof VALID_REVIEW_TYPES)[number];

export const VALID_REVIEW_STATUSES = ["draft", "in_progress", "done"] as const;
export type ReviewStatus = (typeof VALID_REVIEW_STATUSES)[number];

export const VALID_REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  draft: ["in_progress", "done"],
  in_progress: ["done"],
  done: [],
};

export const VALID_SEVERITY_LEVELS = ["critical", "major", "minor", "info"] as const;
export type SeverityLevel = (typeof VALID_SEVERITY_LEVELS)[number];

// ── Event types ──────────────────────────────────────────────────────────────

export const VALID_EVENT_TYPES = [
  "session_start",
  "prd_created",
  "prd_updated",
  "task_started",
  "task_created",
  "task_updated",
  "task_done",
  "task_blocked",
  "task_skipped",
  "prd_activated",
  "prd_ready",
  "prd_review_requested",
  "prd_resumed",
  "prd_done",
  "prd_approved",
  "prd_canceled",
  "prd_forked",
  "review_created",
  "review_updated",
  "review_started",
  "review_done",
  "review_reopened",
  "task_reactivated",
  "task_deleted",
  "phase_advanced",
  "coder_progress",
  "note",
  "error",
] as const;

export type EventType = (typeof VALID_EVENT_TYPES)[number];
