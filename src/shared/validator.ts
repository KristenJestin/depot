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

// ── Task kinds ───────────────────────────────────────────────────────────────
// `slice`   — a vertical user-facing slice that delivers a user story end-to-end
// `gate`    — a quality/release gate (audit, security review, doc sync, etc.)
// `support` — supporting work (refactor, infra, internal helper) without direct UX
export const VALID_TASK_KINDS = ["slice", "gate", "support"] as const;
export type TaskKind = (typeof VALID_TASK_KINDS)[number];

// ── Triage / axis / source ────────────────────────────────────────────────────
// Triage state lives orthogonally to status. Inbound findings start as
// `needs-triage`; the dev orchestrator routes them to `ready-for-agent`,
// `needs-info`, `ready-for-human`, or `wontfix`.
export const VALID_TRIAGE_STATES = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
] as const;
export type TriageState = (typeof VALID_TRIAGE_STATES)[number];

// Axis splits an auditor pass into two parallel concerns:
// `standards` (CLAUDE.md / repo conventions) and `spec` (PRD coverage).
// `human` is the axis stamped on findings created by a human reviewer.
export const VALID_REVIEW_AXES = ["standards", "spec", "human"] as const;
export type ReviewAxis = (typeof VALID_REVIEW_AXES)[number];

// Source of an activity event. Defaults to `ai` for backwards compatibility —
// most events historically come from agents. Direct human CLI invocations
// or web UI actions opt-in to `human`.
export const VALID_ACTIVITY_SOURCES = ["ai", "human"] as const;
export type ActivitySource = (typeof VALID_ACTIVITY_SOURCES)[number];

// ── Doc artifacts ─────────────────────────────────────────────────────────────

export const VALID_DOC_KINDS = ["context", "adr", "glossary", "freeform"] as const;
export type DocKind = (typeof VALID_DOC_KINDS)[number];

export const VALID_ADR_STATUSES = ["proposed", "accepted", "superseded"] as const;
export type AdrStatus = (typeof VALID_ADR_STATUSES)[number];

// ── Pending actions (web → chat bridge) ───────────────────────────────────────

export const VALID_PENDING_ACTION_KINDS = [
  "advance-phase",
  "resume-with-review",
  "run-doc-sync",
  "run-ship",
  "submit-review",
  "custom",
] as const;
export type PendingActionKind = (typeof VALID_PENDING_ACTION_KINDS)[number];

export const VALID_PENDING_ACTION_STATUSES = ["pending", "consumed", "dismissed"] as const;
export type PendingActionStatus = (typeof VALID_PENDING_ACTION_STATUSES)[number];

// ── Project directives ────────────────────────────────────────────────────────

export const VALID_DIRECTIVE_SCOPES = [
  "always",
  "pre-review",
  "pre-commit",
  "pre-doc-sync",
  "pre-ship",
  "on-error",
] as const;
export type DirectiveScope = (typeof VALID_DIRECTIVE_SCOPES)[number];

export const VALID_DIRECTIVE_KINDS = ["command", "rule"] as const;
export type DirectiveKind = (typeof VALID_DIRECTIVE_KINDS)[number];

// Built-in repo targets for `kind: command` directives. Any other value is
// interpreted as a `project_repo.name` and validated dynamically against the
// project's registered repos.
export const VALID_DIRECTIVE_REPO_TARGETS = ["auto", "all", "workspace"] as const;
export type DirectiveRepoTarget = (typeof VALID_DIRECTIVE_REPO_TARGETS)[number];

export const isBuiltinRepoTarget = (value: string): value is DirectiveRepoTarget =>
  (VALID_DIRECTIVE_REPO_TARGETS as readonly string[]).includes(value);

export const VALID_DIRECTIVE_RUN_STATUSES = ["ok", "fail"] as const;
export type DirectiveRunStatus = (typeof VALID_DIRECTIVE_RUN_STATUSES)[number];

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
  "git_commit",
  "git_push",
  "project_config_changed",
  "directive_added",
  "directive_updated",
  "directive_removed",
  "directive_run",
  "pre_review_check",
  "pre_ship_check",
  "pre_doc_sync_check",
] as const;

export type EventType = (typeof VALID_EVENT_TYPES)[number];
