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
// `human`   — a step the agent cannot perform itself (manual action, secret in a
//             vault, etc.) — the agent shows a hand-off script to the user, the
//             user does the action, the agent then runs `depot task verify` with
//             the user's citation (PRD 0018).
export const VALID_TASK_KINDS = ["slice", "gate", "support", "human"] as const;
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
  "pre-coder-spawn",
  "post-auditor-pass",
  "pre-handoff",
  "pre-phase-advance",
] as const;
export type DirectiveScope = (typeof VALID_DIRECTIVE_SCOPES)[number];

export const VALID_DIRECTIVE_KINDS = ["command", "rule"] as const;
export type DirectiveKind = (typeof VALID_DIRECTIVE_KINDS)[number];

// Category dimension introduced in PRD 0013. Each directive is filed under one
// of these so the renderer can inject it into the matching agent template
// (prd / dev / coder / auditor / doc / ship). NOT NULL is enforced at the
// domain layer (`createDirective`) rather than at the SQL layer — SQLite
// cannot retro-fit NOT NULL via ALTER TABLE without recreating the table, and
// the backfill in the migration guarantees the column is populated for every
// existing row.
export const VALID_DIRECTIVE_CATEGORIES = [
  "prd",
  "dev",
  "coder",
  "auditor",
  "doc",
  "ship",
] as const;
export type DirectiveCategory = (typeof VALID_DIRECTIVE_CATEGORIES)[number];

// Authoritative `(category, scope)` validity table (PRD 0013). A directive
// must target exactly one valid pair. If the same instruction should apply
// to two categories (e.g. coder and auditor) it is duplicated — kept simple
// on purpose.
export const VALID_CATEGORY_SCOPES: Record<DirectiveCategory, readonly DirectiveScope[]> = {
  prd: ["always"],
  dev: [
    "always",
    "pre-coder-spawn",
    "pre-review",
    "post-auditor-pass",
    "pre-handoff",
    "pre-phase-advance",
  ],
  coder: ["always", "pre-commit"],
  auditor: ["always", "pre-review"],
  doc: ["always", "pre-doc-sync"],
  ship: ["always", "pre-ship"],
};

export const isValidCategoryScope = (category: DirectiveCategory, scope: DirectiveScope): boolean =>
  (VALID_CATEGORY_SCOPES[category] ?? []).includes(scope);

export const validScopesForCategory = (category: DirectiveCategory): readonly DirectiveScope[] =>
  VALID_CATEGORY_SCOPES[category] ?? [];

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

// ── PRD tags ──────────────────────────────────────────────────────────────────
// Free-form kebab-case identifiers attached to a logical PRD. Pattern:
// lowercase letters/digits/dashes, must start with a letter or digit (no
// leading dash). Length is capped at 50 chars to keep CLI output and the
// future web filter UI well-behaved.

export const TAG_MAX_LENGTH = 50;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const isValidTag = (tag: string): boolean =>
  tag.length > 0 && tag.length <= TAG_MAX_LENGTH && TAG_PATTERN.test(tag);

/**
 * Human-readable explanation of why a tag is rejected. Returns `null` when
 * the tag is valid. The CLI surfaces this verbatim so the user sees the
 * exact constraint that was violated.
 */
export const invalidTagReason = (tag: string): string | null => {
  if (tag.length === 0) return "tag must not be empty";
  if (tag.length > TAG_MAX_LENGTH) {
    return `tag must be at most ${TAG_MAX_LENGTH} characters (got ${tag.length})`;
  }
  if (!TAG_PATTERN.test(tag)) {
    return `tag '${tag}' must match kebab-case pattern ${TAG_PATTERN.source} (lowercase letters/digits/dashes, no leading dash)`;
  }
  return null;
};

// ── PRD annexes (PRD 0024 / T1) ───────────────────────────────────────────────
//
// An annex is a named text artifact attached to a PRD *revision* (substance,
// like body/tasks/reviews — recopied at fork). `kind` is a render hint, the
// `name` is a kebab-case slug that doubles as the key in `[annex: <name>]`
// inline mentions. Validation lives here so the domain layer and CLI share a
// single source of truth.

export const VALID_ANNEX_KINDS = ["html", "markdown", "code", "text"] as const;
export type AnnexKind = (typeof VALID_ANNEX_KINDS)[number];

export const isValidAnnexKind = (value: unknown): value is AnnexKind =>
  typeof value === "string" && (VALID_ANNEX_KINDS as readonly string[]).includes(value);

/** Max length of an annex `name`, mirroring the `isValidTag` style with a
 *  slightly larger budget since annex names are descriptive slugs. */
export const ANNEX_NAME_MAX_LENGTH = 60;
const ANNEX_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const isValidAnnexName = (name: string): boolean =>
  name.length > 0 && name.length <= ANNEX_NAME_MAX_LENGTH && ANNEX_NAME_PATTERN.test(name);

/**
 * Human-readable explanation of why an annex name is rejected. Returns `null`
 * when the name is valid; the CLI surfaces the reason verbatim.
 */
export const invalidAnnexNameReason = (name: string): string | null => {
  if (name.length === 0) return "annex name must not be empty";
  if (name.length > ANNEX_NAME_MAX_LENGTH) {
    return `annex name must be at most ${ANNEX_NAME_MAX_LENGTH} characters (got ${name.length})`;
  }
  if (!ANNEX_NAME_PATTERN.test(name)) {
    return `annex name '${name}' must match kebab-case pattern ${ANNEX_NAME_PATTERN.source} (lowercase letters/digits/dashes, no leading dash)`;
  }
  return null;
};

/** Hard cap on annex `content` (anti-abuse guard, not a v1 config knob). */
export const ANNEX_CONTENT_MAX_BYTES = 2 * 1024 * 1024;

/** Max length of an annex `description` (free text, optional). */
export const ANNEX_DESCRIPTION_MAX_LENGTH = 500;

/**
 * Validate an annex `content` blob. Returns `null` when valid, otherwise a
 * human-readable reason. Content must be a non-empty string whose UTF-8 byte
 * length stays under `ANNEX_CONTENT_MAX_BYTES`.
 */
export const invalidAnnexContentReason = (content: string): string | null => {
  if (content.length === 0) return "annex content must not be empty";
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > ANNEX_CONTENT_MAX_BYTES) {
    return `annex content is ${bytes} bytes, exceeding the ${ANNEX_CONTENT_MAX_BYTES}-byte (2 MB) cap`;
  }
  return null;
};

/** Validate an optional annex `description`. Returns `null` when valid. */
export const invalidAnnexDescriptionReason = (description: string): string | null => {
  if (description.length > ANNEX_DESCRIPTION_MAX_LENGTH) {
    return `annex description must be at most ${ANNEX_DESCRIPTION_MAX_LENGTH} characters (got ${description.length})`;
  }
  return null;
};

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
  "prd_milestone_set",
  "prd_milestone_unset",
  "review_created",
  "review_updated",
  "review_started",
  "review_done",
  "review_reopened",
  "task_reactivated",
  "task_deleted",
  "phase_advanced",
  "prd_phase_initialized",
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
  "pre_coder_check",
  "post_auditor_check",
  "pre_handoff_check",
  "pre_phase_advance_check",
  "prd_tag_added",
  "prd_tag_removed",
  "prd_depend_added",
  "prd_depend_removed",
  "prd_priority_changed",
  "task_verified_human",
  "prd_annex_added",
  "prd_annex_removed",
] as const;

export type EventType = (typeof VALID_EVENT_TYPES)[number];

// ── PRD priority (PRD 0019 / T5) ──────────────────────────────────────────────
//
// Dedicated product-priority enum, layered on top of tags. Tags are free-form
// thematic groupings; priority is a 4-value Likert scale so the UI can rank
// PRDs deterministically (badge colour, default sort order) without sliding
// into kebab-case fragmentation. `normal` is the silent default — newly
// created PRDs inherit it, legacy rows are backfilled to it by the migration.

export const VALID_PRD_PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type PrdPriority = (typeof VALID_PRD_PRIORITIES)[number];

/**
 * Rank values for sorting: higher number = surface earlier. Inverted order so
 * `[...].sort((a, b) => PRD_PRIORITY_RANK[b] - PRD_PRIORITY_RANK[a])` yields
 * critical → high → normal → low.
 */
export const PRD_PRIORITY_RANK: Record<PrdPriority, number> = {
  critical: 3,
  high: 2,
  normal: 1,
  low: 0,
};

export const isValidPrdPriority = (value: unknown): value is PrdPriority =>
  typeof value === "string" && (VALID_PRD_PRIORITIES as readonly string[]).includes(value);

// ── Milestones (PRD 0019 / T3) ────────────────────────────────────────────────

/**
 * Maximum allowed length of a PRD milestone / `target_version` value. Free-form
 * text (semver, dates, codenames) but bounded so a stray paste does not blow
 * up the column index. 50 chars matches the equivalent tag cap.
 */
export const MAX_MILESTONE_LENGTH = 50;

/**
 * Validate a milestone / `target_version` string. Returns `true` when the
 * value is a non-empty string at or below `MAX_MILESTONE_LENGTH`. The check
 * is intentionally permissive: no semver / regex shape is imposed so codenames
 * like `2.7-alpha`, dates like `2026-Q2`, and themes like `agent-polish` are
 * all valid.
 */
export const isValidMilestone = (version: unknown): boolean => {
  if (typeof version !== "string") return false;
  const trimmed = version.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > MAX_MILESTONE_LENGTH) return false;
  return true;
};
