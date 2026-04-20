// ── Projects ─────────────────────────────────────────────────────────────────

export const VALID_PROJECT_STATUSES = ["active", "paused", "done"] as const;
export type ProjectStatus = (typeof VALID_PROJECT_STATUSES)[number];

// ── PRD status transitions ────────────────────────────────────────────────────

export const VALID_PRD_STATUSES = ["draft", "committed", "in_progress", "archived"] as const;
export type PrdStatus = (typeof VALID_PRD_STATUSES)[number];

export const VALID_PRD_TRANSITIONS: Record<PrdStatus, PrdStatus[]> = {
  draft: ["committed"],
  committed: ["in_progress", "archived"],
  in_progress: ["archived"],
  archived: [],
};

export function validatePrdTransition(from: PrdStatus, to: PrdStatus): void {
  const allowed = VALID_PRD_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid PRD transition: '${from}' -> '${to}'. Allowed: ${(allowed ?? []).join(", ") || "none"}`,
    );
  }
}

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

export function validateTaskTransition(from: TaskStatus, to: TaskStatus): void {
  const allowed = VALID_TASK_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid task transition: '${from}' -> '${to}'. Allowed: ${(allowed ?? []).join(", ") || "none"}`,
    );
  }
}

// ── Effort ───────────────────────────────────────────────────────────────────

export const VALID_EFFORTS = ["xs", "s", "m", "l", "xl"] as const;
export type Effort = (typeof VALID_EFFORTS)[number];

export function validateEffort(value: string): asserts value is Effort {
  if (!VALID_EFFORTS.includes(value as Effort)) {
    throw new Error(
      `Invalid effort value: '${value}'. Must be one of: ${VALID_EFFORTS.join(", ")}`,
    );
  }
}

// ── Non-empty string ─────────────────────────────────────────────────────────

export function validateNonEmpty(value: string, fieldName: string): void {
  if (!value || value.trim() === "") {
    throw new Error(`${fieldName} must not be empty`);
  }
}

// ── Event types ──────────────────────────────────────────────────────────────

export const VALID_EVENT_TYPES = [
  "session_start",
  "task_started",
  "task_done",
  "task_blocked",
  "task_skipped",
  "prd_committed",
  "prd_activated",
  "prd_amended",
  "note",
  "handoff",
  "error",
] as const;

export type EventType = (typeof VALID_EVENT_TYPES)[number];

export function validateEventType(value: string): asserts value is EventType {
  if (!VALID_EVENT_TYPES.includes(value as EventType)) {
    throw new Error(
      `Invalid event type: '${value}'. Must be one of: ${VALID_EVENT_TYPES.join(", ")}`,
    );
  }
}
