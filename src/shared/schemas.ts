import { Schema } from "effect";
import {
  VALID_EFFORTS,
  VALID_EVENT_TYPES,
  VALID_PRD_PRIORITIES,
  VALID_TASK_KINDS,
  VALID_TRIAGE_STATES,
  VALID_ANNEX_KINDS,
  type EventType,
} from "#/shared/validator";

function parseLooseJsonLike(input: string): Record<string, unknown> {
  let index = 0;

  function skipWhitespace(): void {
    while (index < input.length && /\s/.test(input[index]!)) {
      index += 1;
    }
  }

  function expectChar(char: string): void {
    skipWhitespace();
    if (input[index] !== char) {
      throw new Error(`Expected '${char}' at position ${index}`);
    }
    index += 1;
  }

  function parseQuotedString(): string {
    const quote = input[index]!;
    index += 1;
    let value = "";

    while (index < input.length) {
      const char = input[index]!;
      if (char === "\\") {
        const next = input[index + 1];
        if (next) {
          value += next;
          index += 2;
          continue;
        }
      }
      if (char === quote) {
        index += 1;
        return value;
      }
      value += char;
      index += 1;
    }

    throw new Error("Unterminated string literal");
  }

  function parseBareToken(): unknown {
    const start = index;
    while (index < input.length && ![",", "}", "]"].includes(input[index]!)) {
      index += 1;
    }

    const raw = input.slice(start, index).trim();
    if (raw === "") {
      throw new Error(`Unexpected empty token at position ${start}`);
    }
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      return Number(raw);
    }

    return raw;
  }

  function parseArray(): unknown[] {
    expectChar("[");
    const items: unknown[] = [];
    skipWhitespace();
    if (input[index] === "]") {
      index += 1;
      return items;
    }

    while (index < input.length) {
      items.push(parseValue());
      skipWhitespace();
      if (input[index] === ",") {
        index += 1;
        continue;
      }
      if (input[index] === "]") {
        index += 1;
        return items;
      }
      throw new Error(`Expected ',' or ']' at position ${index}`);
    }

    throw new Error("Unterminated array literal");
  }

  function parseKey(): string {
    skipWhitespace();
    const current = input[index];
    if (current === '"' || current === "'") {
      return parseQuotedString();
    }

    const start = index;
    while (index < input.length && input[index] !== ":") {
      index += 1;
    }
    const key = input.slice(start, index).trim();
    if (!key) {
      throw new Error(`Expected object key at position ${start}`);
    }
    return key;
  }

  function parseObject(): Record<string, unknown> {
    expectChar("{");
    const result: Record<string, unknown> = {};
    skipWhitespace();
    if (input[index] === "}") {
      index += 1;
      return result;
    }

    while (index < input.length) {
      const key = parseKey();
      expectChar(":");
      result[key] = parseValue();
      skipWhitespace();
      if (input[index] === ",") {
        index += 1;
        continue;
      }
      if (input[index] === "}") {
        index += 1;
        return result;
      }
      throw new Error(`Expected ',' or '}' at position ${index}`);
    }

    throw new Error("Unterminated object literal");
  }

  function parseValue(): unknown {
    skipWhitespace();
    const current = input[index];
    if (current === "{") return parseObject();
    if (current === "[") return parseArray();
    if (current === '"' || current === "'") return parseQuotedString();
    return parseBareToken();
  }

  const value = parseValue();
  skipWhitespace();
  if (index !== input.length) {
    throw new Error(`Unexpected trailing content at position ${index}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Payload must be a JSON object");
  }

  return value as Record<string, unknown>;
}

export function parseJsonLike(val: string): Record<string, unknown> {
  try {
    return JSON.parse(val) as Record<string, unknown>;
  } catch {
    return parseLooseJsonLike(val);
  }
}

// ── Field schemas ─────────────────────────────────────────────────────────────

// Single source of truth: enum values come from validator.ts constants.
export const effortSchema = Schema.Literal(...VALID_EFFORTS);
export const taskKindSchema = Schema.Literal(...VALID_TASK_KINDS);
export const triageStateSchema = Schema.Literal(...VALID_TRIAGE_STATES);
export const eventTypeSchema = Schema.Literal(...VALID_EVENT_TYPES);

// ── Activity payload schemas ──────────────────────────────────────────────────

/**
 * Per-event-type Effect/Schema schemas for activity log payloads.
 * Used in logActivity() to validate payload shape at runtime.
 * Unknown extra fields are stripped (forward-compatible).
 * any: necessary to hold heterogeneous per-event schemas in a single Record.
 */
export const activityPayloadSchemas: Record<EventType, Schema.Schema<any, any, never>> = {
  session_start: Schema.Struct({ context: Schema.optional(Schema.String) }),
  prd_created: Schema.Struct({ prdId: Schema.optional(Schema.String), title: Schema.String }),
  prd_updated: Schema.Struct({
    prdId: Schema.optional(Schema.String),
    prdRevisionId: Schema.optional(Schema.String),
    title: Schema.String,
    fields: Schema.Array(Schema.String),
  }),
  // taskId and prdId are optional to preserve CLI compatibility: `depot log add` callers
  // do not supply these fields when logging manually via the CLI.
  task_started: Schema.Struct({ taskId: Schema.optional(Schema.String), title: Schema.String }),
  task_created: Schema.Struct({
    taskId: Schema.optional(Schema.String),
    title: Schema.String,
    kind: Schema.optional(Schema.String),
  }),
  task_updated: Schema.Struct({
    taskId: Schema.optional(Schema.String),
    title: Schema.String,
    fields: Schema.Array(Schema.String),
    kind: Schema.optional(Schema.String),
  }),
  task_done: Schema.Struct({ taskId: Schema.optional(Schema.String), title: Schema.String }),
  task_blocked: Schema.Struct({
    taskId: Schema.optional(Schema.String),
    title: Schema.String,
    reason: Schema.String,
  }),
  task_skipped: Schema.Struct({
    taskId: Schema.optional(Schema.String),
    title: Schema.String,
    reason: Schema.String,
  }),
  prd_activated: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    title: Schema.String,
    sha: Schema.optional(Schema.String),
    userConfirmation: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  prd_ready: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    title: Schema.String,
    userConfirmation: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  prd_review_requested: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    title: Schema.String,
    reason: Schema.optional(Schema.String),
    userConfirmation: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  prd_resumed: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    title: Schema.String,
    userConfirmation: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  prd_done: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    title: Schema.String,
    sha: Schema.optional(Schema.String),
    userConfirmation: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  prd_approved: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    approvedBy: Schema.optional(Schema.NullOr(Schema.String)),
    comment: Schema.optional(Schema.NullOr(Schema.String)),
    approvedAt: Schema.String,
  }),
  prd_canceled: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    title: Schema.String,
    userConfirmation: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  prd_forked: Schema.Struct({
    sourcePrdRevisionId: Schema.String,
    newPrdRevisionId: Schema.String,
    revision: Schema.Number,
  }),
  prd_milestone_set: Schema.Struct({
    prdId: Schema.String,
    previousVersion: Schema.NullOr(Schema.String),
    newVersion: Schema.String,
  }),
  prd_milestone_unset: Schema.Struct({
    prdId: Schema.String,
    previousVersion: Schema.NullOr(Schema.String),
    newVersion: Schema.Null,
  }),
  review_created: Schema.Struct({
    reviewId: Schema.String,
    prdRevisionId: Schema.optional(Schema.String),
    type: Schema.String,
  }),
  review_updated: Schema.Struct({
    reviewId: Schema.String,
    prdRevisionId: Schema.optional(Schema.String),
    fields: Schema.Array(Schema.String),
  }),
  review_started: Schema.Struct({
    reviewId: Schema.String,
    prdRevisionId: Schema.optional(Schema.String),
  }),
  review_done: Schema.Struct({
    reviewId: Schema.String,
    prdRevisionId: Schema.optional(Schema.String),
  }),
  review_reopened: Schema.Struct({
    reviewId: Schema.String,
    prdRevisionId: Schema.optional(Schema.String),
  }),
  task_reactivated: Schema.Struct({
    taskId: Schema.String,
    title: Schema.String,
    previousSkipReason: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  task_deleted: Schema.Struct({
    taskId: Schema.String,
    title: Schema.String,
  }),
  phase_advanced: Schema.Struct({
    prdRevisionId: Schema.String,
    fromPhase: Schema.Number,
    toPhase: Schema.optional(Schema.Number),
    sha: Schema.optional(Schema.String),
    userConfirmation: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  prd_phase_initialized: Schema.Struct({
    prdRevisionId: Schema.String,
    fromPhase: Schema.NullOr(Schema.Number),
    toPhase: Schema.Number,
    derivedFromTasks: Schema.Boolean,
    userConfirmation: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  coder_progress: Schema.Struct({
    stage: Schema.Literal("start", "edit", "verify", "tool", "note", "error"),
    message: Schema.String,
    taskId: Schema.optional(Schema.String),
    file: Schema.optional(Schema.String),
    tool: Schema.optional(Schema.String),
    command: Schema.optional(Schema.String),
    source: Schema.optional(Schema.Literal("agent", "plugin")),
    output: Schema.optional(Schema.String),
    exitCode: Schema.optional(Schema.Number),
  }),
  note: Schema.Struct({ message: Schema.String }),
  error: Schema.Struct({ message: Schema.String, details: Schema.optional(Schema.String) }),
  git_commit: Schema.Struct({
    sha: Schema.String,
    message: Schema.String,
    filesChanged: Schema.optional(Schema.Number),
  }),
  git_push: Schema.Struct({
    branch: Schema.String,
    remote: Schema.optional(Schema.String),
    commitsPushed: Schema.optional(Schema.Number),
  }),
  project_config_changed: Schema.Struct({
    key: Schema.String,
    previousValue: Schema.optional(Schema.NullOr(Schema.String)),
    newValue: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  directive_added: Schema.Struct({ directiveId: Schema.String, title: Schema.String }),
  directive_updated: Schema.Struct({
    directiveId: Schema.String,
    /**
     * Per-field diff captured at update time (PRD 0017 / T5). Keys are the
     * patched field names; values record the previous and new value so the
     * activity feed can render meaningful entries instead of a bare list of
     * field names.
     */
    changes: Schema.Record({
      key: Schema.String,
      value: Schema.Struct({
        from: Schema.Unknown,
        to: Schema.Unknown,
      }),
    }),
  }),
  directive_removed: Schema.Struct({ directiveId: Schema.String }),
  directive_run: Schema.Struct({
    directiveId: Schema.String,
    status: Schema.String,
    durationMs: Schema.optional(Schema.Number),
    /** Original `repoTarget` value declared on the directive. */
    repoTarget: Schema.optional(Schema.String),
    /**
     * Repo selection traceability (PRD 0007 T1). Records which repos the run
     * actually targeted and why — so `repoTarget=auto` is never silent in
     * multi-repo projects.
     */
    selection: Schema.optional(
      Schema.Struct({
        reason: Schema.Literal(
          "single-repo",
          "auto-dirty",
          "auto-no-dirty",
          "all",
          "workspace",
          "named",
          "named-missing",
        ),
        repos: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })),
        consideredRepos: Schema.optional(
          Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })),
        ),
      }),
    ),
  }),
  pre_review_check: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    ok: Schema.Boolean,
    failingDirectiveId: Schema.optional(Schema.String),
  }),
  pre_ship_check: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    ok: Schema.Boolean,
    failingDirectiveId: Schema.optional(Schema.String),
  }),
  pre_doc_sync_check: Schema.Struct({
    ok: Schema.Boolean,
    failingDirectiveId: Schema.optional(Schema.String),
  }),
  pre_coder_check: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    ok: Schema.Boolean,
    failingDirectiveId: Schema.optional(Schema.String),
  }),
  post_auditor_check: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    ok: Schema.Boolean,
    failingDirectiveId: Schema.optional(Schema.String),
  }),
  pre_handoff_check: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    ok: Schema.Boolean,
    failingDirectiveId: Schema.optional(Schema.String),
  }),
  pre_phase_advance_check: Schema.Struct({
    prdRevisionId: Schema.optional(Schema.String),
    ok: Schema.Boolean,
    failingDirectiveId: Schema.optional(Schema.String),
  }),
  prd_tag_added: Schema.Struct({
    prdId: Schema.String,
    tag: Schema.String,
  }),
  prd_tag_removed: Schema.Struct({
    prdId: Schema.String,
    tag: Schema.String,
  }),
  prd_depend_added: Schema.Struct({
    prdId: Schema.String,
    dependsOnPrdId: Schema.String,
  }),
  prd_depend_removed: Schema.Struct({
    prdId: Schema.String,
    dependsOnPrdId: Schema.String,
  }),
  prd_priority_changed: Schema.Struct({
    prdId: Schema.String,
    previousPriority: Schema.Literal(...VALID_PRD_PRIORITIES),
    newPriority: Schema.Literal(...VALID_PRD_PRIORITIES),
  }),
  // PRD 0024: annex add/remove on a PRD revision. Not a lifecycle transition,
  // so no `--user-confirmed` quote — the payload carries enough to render the
  // activity feed without re-reading the annex row.
  prd_annex_added: Schema.Struct({
    annexId: Schema.String,
    name: Schema.String,
    kind: Schema.Literal(...VALID_ANNEX_KINDS),
  }),
  prd_annex_removed: Schema.Struct({
    annexId: Schema.String,
    name: Schema.String,
    kind: Schema.Literal(...VALID_ANNEX_KINDS),
  }),
  // PRD 0018: emitted by `verifyTask` on every verify attempt — success or
  // failure. `verificationExitCode/Stdout/Stderr` are present when the task
  // carried a `verificationCommand`; they are omitted for an ack-only verify.
  task_verified_human: Schema.Struct({
    taskId: Schema.String,
    userConfirmation: Schema.NullOr(Schema.String),
    verificationExitCode: Schema.optional(Schema.Number),
    verificationStdout: Schema.optional(Schema.String),
    verificationStderr: Schema.optional(Schema.String),
  }),
  prototype_created: Schema.Struct({
    prototypeId: Schema.String,
    prdRevisionId: Schema.String,
    slug: Schema.String,
  }),
  prototype_archived: Schema.Struct({
    prototypeId: Schema.String,
  }),
  prototype_page_added: Schema.Struct({
    prototypeId: Schema.String,
    pageId: Schema.String,
    slug: Schema.String,
    title: Schema.String,
  }),
  prototype_page_removed: Schema.Struct({
    prototypeId: Schema.String,
    pageId: Schema.String,
    slug: Schema.String,
  }),
  prototype_version_added: Schema.Struct({
    pageId: Schema.String,
    versionId: Schema.String,
    label: Schema.String,
  }),
  prototype_version_archived: Schema.Struct({
    pageId: Schema.String,
    versionId: Schema.String,
    label: Schema.String,
  }),
  prototype_version_restored: Schema.Struct({
    pageId: Schema.String,
    versionId: Schema.String,
    label: Schema.String,
  }),
  prototype_variant_added: Schema.Struct({
    pageVersionId: Schema.String,
    variantId: Schema.String,
    label: Schema.String,
    isMain: Schema.Boolean,
  }),
  prototype_variant_removed: Schema.Struct({
    pageVersionId: Schema.String,
    variantId: Schema.String,
    label: Schema.String,
  }),
  prototype_variant_main_changed: Schema.Struct({
    pageVersionId: Schema.String,
    previousMainVariantId: Schema.NullOr(Schema.String),
    newMainVariantId: Schema.String,
  }),
  prototype_variant_elected: Schema.Struct({
    pageId: Schema.String,
    variantId: Schema.String,
    rationale: Schema.String,
    decidedBy: Schema.NullOr(Schema.String),
  }),
  prototype_variant_unelected: Schema.Struct({
    pageId: Schema.String,
  }),
  // PRD 0029: round lifecycle on a prototype. Logging is emitted at the CLI
  // layer (the domain stays log-free); the schemas live here so the event-type
  // Record stays exhaustive and the payload contract is fixed up front.
  prototype_round_created: Schema.Struct({
    prototypeId: Schema.String,
    roundId: Schema.String,
    label: Schema.String,
    fromRoundId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  prototype_round_page_pinned: Schema.Struct({
    roundId: Schema.String,
    pageId: Schema.String,
    pageVersionId: Schema.String,
  }),
  prototype_round_page_dropped: Schema.Struct({
    roundId: Schema.String,
    pageId: Schema.String,
  }),
  prd_design_distilled: Schema.Struct({
    prdRevisionId: Schema.String,
    length: Schema.Number,
  }),
  prototype_page_placement_distilled: Schema.Struct({
    roundId: Schema.String,
    pageId: Schema.String,
    slug: Schema.String,
    length: Schema.Number,
  }),
  prototype_feedback_added: Schema.Struct({
    feedbackId: Schema.String,
    variantId: Schema.String,
    hasPin: Schema.Boolean,
  }),
  prototype_feedback_resolved: Schema.Struct({
    feedbackId: Schema.String,
    variantId: Schema.String,
    viaVariantId: Schema.optional(Schema.NullOr(Schema.String)),
    hasNote: Schema.Boolean,
  }),
  prototype_feedback_ignored: Schema.Struct({
    feedbackId: Schema.String,
    variantId: Schema.String,
    reason: Schema.String,
  }),
  prototype_feedback_deleted: Schema.Struct({
    feedbackId: Schema.String,
    variantId: Schema.String,
    hasPin: Schema.Boolean,
  }),
  // PRD 0027: idea capture lifecycle. Logging is emitted at the CLI layer (the
  // domain stays log-free, on the prototype model); the schemas live here so
  // the event-type Record stays exhaustive and the contract is fixed up front.
  idea_created: Schema.Struct({
    ideaId: Schema.String,
    title: Schema.String,
    tag: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  idea_updated: Schema.Struct({
    ideaId: Schema.String,
    title: Schema.String,
    fields: Schema.Array(Schema.String),
  }),
  idea_promoted: Schema.Struct({
    ideaId: Schema.String,
    promotedPrdId: Schema.String,
  }),
  idea_dropped: Schema.Struct({
    ideaId: Schema.String,
    reason: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  idea_reopened: Schema.Struct({
    ideaId: Schema.String,
  }),
};
