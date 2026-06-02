import { defineRelations } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  VALID_EFFORTS,
  VALID_PRD_PRIORITIES,
  VALID_PRD_STATUSES,
  VALID_PROJECT_STATUSES,
  VALID_REVIEW_STATUSES,
  VALID_REVIEW_TYPES,
  VALID_SEVERITY_LEVELS,
  VALID_TASK_DESCRIPTION_FORMATS,
  VALID_TASK_KINDS,
  VALID_TASK_STATUSES,
  VALID_TRIAGE_STATES,
  VALID_REVIEW_AXES,
  VALID_ACTIVITY_SOURCES,
  VALID_DOC_KINDS,
  VALID_ADR_STATUSES,
  VALID_PENDING_ACTION_KINDS,
  VALID_PENDING_ACTION_STATUSES,
  VALID_DIRECTIVE_SCOPES,
  VALID_DIRECTIVE_KINDS,
  VALID_DIRECTIVE_CATEGORIES,
  VALID_DIRECTIVE_RUN_STATUSES,
  VALID_ANNEX_KINDS,
} from "#/shared/validator";
import { generateId } from "#/shared/utils";

// ── Projects ──────────────────────────────────────────────────────────────────

export const projects = sqliteTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text(),
  status: text({ enum: VALID_PROJECT_STATUSES }).notNull().default("active"),
  createdAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

// ── Workspaces ────────────────────────────────────────────────────────────────

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    path: text().notNull().unique(), // canonical absolute path
    label: text(), // optional human label
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [index("workspaces_project_id_idx").on(table.projectId)],
);

// ── Project repos ─────────────────────────────────────────────────────────────
//
// Optional registry of the git repos that make up a project. A project with
// no `project_repo` rows falls back to a single implicit repo resolved from
// the workspace path (see `resolveProjectRepos`). Multi-repo projects register
// one row per repo so directive runs, guards, and repo-aware context can target
// each repo independently.

export const projectRepos = sqliteTable(
  "project_repo",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    name: text().notNull(), // unique per project — e.g. `front`, `api`, `common`
    path: text().notNull(), // absolute or relative to the workspace
    isPrimary: integer({ mode: "boolean" }).notNull().default(false),
    baseBranch: text().notNull().default("main"), // each repo carries its own base branch
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("project_repo_project_id_idx").on(table.projectId),
    uniqueIndex("project_repo_project_name_idx").on(table.projectId, table.name),
  ],
);

// ── PRD repos (M:N) ───────────────────────────────────────────────────────────
//
// Declares which `project_repo` rows are in the scope of a PRD revision.
// Cardinality 0 is valid: a project with no `project_repo` rows (mono-repo) or
// a PRD whose repo scope has not yet been declared. The link is posted on
// `prd_revisions` rather than the logical PRD so a fork can widen or narrow
// the scope cleanly. `task.repoId` is then validated against this set.

export const prdRepos = sqliteTable(
  "prd_repo",
  {
    id: text().primaryKey(),
    prdRevisionId: text()
      .notNull()
      .references(() => prdRevisions.id),
    repoId: text()
      .notNull()
      .references(() => projectRepos.id),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("prd_repo_prd_revision_id_idx").on(table.prdRevisionId),
    index("prd_repo_repo_id_idx").on(table.repoId),
    uniqueIndex("prd_repo_prd_revision_repo_idx").on(table.prdRevisionId, table.repoId),
  ],
);

// ── PRDs (logical containers) ─────────────────────────────────────────────────
//
// A PRD logical entity is a stable identifier for a product requirement.
// It always points to its current (head) revision via `currentRevisionId`.
// Revisions are created via fork; the logical ID never changes.

export const prds = sqliteTable(
  "prds",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    // Points to the head revision. Nullable only during the initial insert;
    // always set before the row is returned to callers.
    // The circular FK (prds ↔ prd_revisions) is enforced at the application level;
    // SQLite drizzle does not support DEFERRABLE so we omit the FK here.
    currentRevisionId: text(),
    // Optional milestone / release tag (PRD 0019 / T3). Free-form text so
    // semver, dates, and codenames are all acceptable. Validation lives in
    // the domain layer (`isValidMilestone`).
    targetVersion: text(),
    // Product priority (PRD 0019 / T5). 4-value enum, defaults to `normal`
    // for legacy rows backfilled by the migration and for every newly
    // created PRD. The CLI/UI uses the ordered enum for default-sort and
    // the badge palette.
    priority: text({ enum: VALID_PRD_PRIORITIES }).notNull().default("normal"),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("prds_project_id_idx").on(table.projectId),
    index("prds_current_revision_id_idx").on(table.currentRevisionId),
    index("prds_target_version_idx").on(table.targetVersion),
    index("idx_prds_priority").on(table.priority),
  ],
);

// ── PRD dependencies (M:N DAG) ────────────────────────────────────────────────
//
// Declares a hard dependency between two logical PRDs ("this PRD depends on
// that one"). Acyclicity is enforced at insert time in the domain layer via
// DFS — see `src/modules/prds/dependencies.ts`. A CHECK constraint on the
// table refuses self-dependencies at the SQL layer. Both columns reference
// the logical PRDs (not revisions), so a dependency survives fork.

export const prdDependsOn = sqliteTable(
  "prd_depends_on",
  {
    prdId: text()
      .notNull()
      .references(() => prds.id),
    dependsOnPrdId: text()
      .notNull()
      .references(() => prds.id),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.prdId, table.dependsOnPrdId] }),
    index("prd_depends_on_inverse_idx").on(table.dependsOnPrdId, table.prdId),
  ],
);

// ── PRD Revisions ─────────────────────────────────────────────────────────────
//
// Each revision is an immutable snapshot of the PRD spec at a point in time.
// A new revision is created only via `depot prd fork` from a `ready` revision.
// The first revision (`revision = 1`) is created alongside the logical PRD.
//
// Spec fields (title, context, scope) and all runtime/workflow state live here.
// Tasks, reviews, and activity entries are attached to a revision, not the
// logical PRD, to avoid ambiguity between revisions.

export const prdRevisions = sqliteTable(
  "prd_revisions",
  {
    id: text().primaryKey(),
    prdId: text()
      .notNull()
      .references(() => prds.id),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    workspaceId: text().references(() => workspaces.id), // set at activation, null until then
    revision: integer().notNull().default(1),
    title: text().notNull(),
    context: text(), // why this PRD exists
    scope: text(), // what is included and excluded
    problem: text(), // structured: problem statement
    solution: text(), // structured: chosen solution / approach summary
    implementationDecisions: text(), // structured: key impl decisions
    testingDecisions: text(), // structured: how the work will be tested
    status: text({ enum: VALID_PRD_STATUSES }).notNull().default("draft"),
    auditCycles: integer().notNull().default(0),
    currentPhase: integer(), // null = single-phase; >= 1 = current phase number
    supersededAt: integer({ mode: "timestamp_ms" }), // set when a fork creates a newer revision
    suggestedCommitMessage: text(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    readyAt: integer({ mode: "timestamp_ms" }),
    activatedAt: integer({ mode: "timestamp_ms" }),
  },
  (table) => [
    index("prd_revisions_prd_id_idx").on(table.prdId),
    index("prd_revisions_project_id_idx").on(table.projectId),
    index("prd_revisions_workspace_id_idx").on(table.workspaceId),
  ],
);

// ── PRD tags (M:N) ────────────────────────────────────────────────────────────
//
// Free-form tags attached to a logical PRD (kebab-case, validated at the
// domain layer). A PRD has 0+ tags, a tag is attached to 0+ PRDs. The tag set
// survives forks: tagging happens on the logical `prds.id`, not on
// `prd_revisions.id`, so renaming or rev-bumping a PRD never loses its
// thematic groupings.

export const prdTags = sqliteTable(
  "prd_tags",
  {
    prdId: text()
      .notNull()
      .references(() => prds.id),
    tag: text().notNull(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.prdId, table.tag] }),
    // Inverse index for `listPrdsForTag` — "what PRDs carry this tag?".
    index("idx_prd_tags_tag_prd").on(table.tag, table.prdId),
  ],
);

// ── PRD annexes (PRD 0024 / T1) ───────────────────────────────────────────────
//
// A named text artifact (HTML prototype, data sample, example output, …)
// attached to a PRD *revision*. Annexes are substance, not metadata: like the
// body, tasks and reviews they hang off `prd_revisions` (not the logical PRD)
// and are recopied into the new revision on fork, so each revision stays
// self-contained and the body↔annex coherence is preserved per revision.
//
// `name` is a kebab-case slug, unique per revision, that doubles as the key in
// inline `[annex: <name>]` mentions in the PRD body. `kind` is a render hint;
// `description` is the relevance summary the agent reads before deciding to
// `annex cat`. `content` holds the full text (capped at 2 MB in the domain).

export const prdAnnexes = sqliteTable(
  "prd_annexes",
  {
    id: text().primaryKey(),
    prdRevisionId: text()
      .notNull()
      .references(() => prdRevisions.id),
    name: text().notNull(), // kebab-case slug, unique per revision
    kind: text({ enum: VALID_ANNEX_KINDS }).notNull(),
    description: text(), // free-form relevance summary, optional
    content: text().notNull(), // full text artifact
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("prd_annexes_prd_revision_id_idx").on(table.prdRevisionId),
    uniqueIndex("prd_annexes_prd_revision_name_idx").on(table.prdRevisionId, table.name),
  ],
);

// ── Reviews ───────────────────────────────────────────────────────────────────

export const reviews = sqliteTable(
  "reviews",
  {
    id: text().primaryKey(),
    // Points to the revision this review was opened against.
    prdRevisionId: text()
      .notNull()
      .references(() => prdRevisions.id),
    type: text({ enum: VALID_REVIEW_TYPES }).notNull(),
    status: text({ enum: VALID_REVIEW_STATUSES }).notNull().default("draft"),
    userFeedback: text(),
    phaseNumber: integer(), // set automatically when review is created during a multi-phase PRD
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    doneAt: integer({ mode: "timestamp_ms" }),
  },
  (table) => [index("reviews_prd_revision_id_idx").on(table.prdRevisionId)],
);

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
  "tasks",
  {
    id: text().primaryKey(),
    // For PRD tasks: points to the revision they belong to.
    // For review tasks: also points to the revision (same revision as the review).
    prdRevisionId: text()
      .notNull()
      .references(() => prdRevisions.id),
    position: integer().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    descriptionFormat: text({ enum: VALID_TASK_DESCRIPTION_FORMATS })
      .notNull()
      .default("structured_v1"),
    doneCriteria: text().notNull(), // textual, non-empty
    dependsOn: text().notNull().default("[]"), // JSON array of task ids
    effort: text({ enum: VALID_EFFORTS }).notNull(),
    kind: text({ enum: VALID_TASK_KINDS }).notNull().default("slice"),
    phaseNumber: integer(), // which phase this task belongs to; null = single-phase PRD
    status: text({ enum: VALID_TASK_STATUSES }).notNull().default("pending"),
    reviewId: text().references(() => reviews.id), // set when task belongs to a review
    // Repo the task is attached to. Must be in the parent PRD's `prd_repo`
    // when set. Always nullable — `null` means the task is not bound to any
    // `project_repo` (mono-repo, or a project-wide change like a CLAUDE.md at
    // the shell root). Validation lives in the domain layer.
    repoId: text().references(() => projectRepos.id),
    severity: text({ enum: VALID_SEVERITY_LEVELS }), // relevant when reviewId is set
    axis: text({ enum: VALID_REVIEW_AXES }), // relevant when reviewId is set
    triageState: text({ enum: VALID_TRIAGE_STATES }).notNull().default("ready-for-agent"),
    linkedFilePath: text(), // relevant when finding came from web diff viewer
    linkedStartLine: integer(),
    linkedEndLine: integer(),
    linkedDiffSha: text(),
    blockedReason: text(), // required when status = blocked
    skipReason: text(), // required when status = skipped
    // Optional shell command run by `depot task verify` (PRD 0018). Only
    // meaningful for `kind = "human"` tasks: when present, the agent's verify
    // call executes it (via `execFile` in the workspace cwd, with the timeout
    // `DEPOT_VERIFY_TIMEOUT_MS`) to check the user actually did the manual
    // action. When absent, the user's `--user-confirmed` quote alone marks
    // the task done. Stored as nullable free text — safety patterns are
    // enforced at the domain layer (`assertSafeInstruction`).
    verificationCommand: text(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    startedAt: integer({ mode: "timestamp_ms" }),
    completedAt: integer({ mode: "timestamp_ms" }),
  },
  (table) => [
    index("tasks_prd_revision_id_idx").on(table.prdRevisionId),
    index("tasks_review_id_idx").on(table.reviewId),
  ],
);

// ── User Stories ──────────────────────────────────────────────────────────────

export const userStories = sqliteTable(
  "user_stories",
  {
    id: text().primaryKey(),
    prdRevisionId: text()
      .notNull()
      .references(() => prdRevisions.id),
    position: integer().notNull().default(0),
    asRole: text().notNull(), // "as a <role>"
    want: text().notNull(), // "I want <action>"
    so: text().notNull(), // "so that <benefit>"
    notes: text(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("user_stories_prd_revision_id_idx").on(table.prdRevisionId),
    index("user_stories_position_idx").on(table.prdRevisionId, table.position),
  ],
);

export const taskUserStories = sqliteTable(
  "task_user_stories",
  {
    taskId: text()
      .notNull()
      .references(() => tasks.id),
    userStoryId: text()
      .notNull()
      .references(() => userStories.id),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userStoryId] }),
    index("task_user_stories_story_idx").on(table.userStoryId),
  ],
);

// ── Out of scope items ────────────────────────────────────────────────────────

export const outOfScopeItems = sqliteTable(
  "out_of_scope_items",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    prdRevisionId: text().references(() => prdRevisions.id), // null = project-wide
    title: text().notNull(),
    reason: text().notNull(),
    decidedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    decidedBy: text(),
    linkedReviewTaskId: text().references(() => tasks.id),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("out_of_scope_items_project_id_idx").on(table.projectId),
    index("out_of_scope_items_prd_revision_id_idx").on(table.prdRevisionId),
  ],
);

// ── Doc artifacts ─────────────────────────────────────────────────────────────

export const docArtifacts = sqliteTable(
  "doc_artifacts",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    workspaceId: text().references(() => workspaces.id),
    kind: text({ enum: VALID_DOC_KINDS }).notNull(),
    path: text().notNull(), // relative to workspace
    number: integer(), // ADR number, null for other kinds
    title: text().notNull(),
    status: text({ enum: VALID_ADR_STATUSES }),
    supersededBy: text(),
    linkedPrdRevisionId: text().references(() => prdRevisions.id),
    lastModifiedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastModifiedBySource: text({ enum: VALID_ACTIVITY_SOURCES }).notNull().default("ai"),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("doc_artifacts_project_kind_idx").on(table.projectId, table.kind),
    index("doc_artifacts_project_path_idx").on(table.projectId, table.path),
  ],
);

// ── Doc profiles & sync history ───────────────────────────────────────────────

export const docProfiles = sqliteTable(
  "doc_profiles",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    name: text().notNull(),
    targetRoot: text().notNull(),
    targetPattern: text().notNull().default("**/*.md"),
    sources: text().notNull().default("[]"), // JSON array
    language: text().notNull().default("en"),
    style: text().notNull().default("mixed"), // narrative|reference|mixed
    audience: text(),
    routingRules: text().notNull().default("[]"), // JSON array
    topicsToCover: text().notNull().default("[]"),
    topicsToIgnore: text().notNull().default("[]"),
    guardrails: text().notNull().default("[]"),
    commitPolicy: text().notNull().default("leave-in-working-tree"),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [index("doc_profiles_project_name_idx").on(table.projectId, table.name)],
);

export const docSyncRuns = sqliteTable(
  "doc_sync_runs",
  {
    id: text().primaryKey(),
    profileId: text()
      .notNull()
      .references(() => docProfiles.id),
    triggeredByPrdId: text().references(() => prdRevisions.id),
    sinceRef: text(),
    untilRef: text(),
    ranAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    summary: text(),
    filesChanged: text().notNull().default("[]"),
  },
  (table) => [
    index("doc_sync_runs_profile_idx").on(table.profileId),
    index("doc_sync_runs_triggered_by_prd_idx").on(table.triggeredByPrdId),
  ],
);

// ── Project config ────────────────────────────────────────────────────────────

export const projectConfig = sqliteTable(
  "project_config",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id),
    key: text().notNull(),
    value: text().notNull(),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    updatedBySource: text({ enum: VALID_ACTIVITY_SOURCES }).notNull().default("ai"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.key] })],
);

// ── Pending actions ───────────────────────────────────────────────────────────

export const pendingActions = sqliteTable(
  "pending_actions",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    kind: text({ enum: VALID_PENDING_ACTION_KINDS }).notNull(),
    payload: text().notNull().default("{}"),
    status: text({ enum: VALID_PENDING_ACTION_STATUSES }).notNull().default("pending"),
    sourcePrdId: text().references(() => prdRevisions.id),
    slashCommand: text().notNull(),
    humanReadableLabel: text().notNull(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    consumedAt: integer({ mode: "timestamp_ms" }),
    consumedBySource: text({ enum: VALID_ACTIVITY_SOURCES }),
  },
  (table) => [
    index("pending_actions_project_status_idx").on(table.projectId, table.status, table.createdAt),
  ],
);

// ── Project directives ────────────────────────────────────────────────────────

export const projectDirectives = sqliteTable(
  "project_directives",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    scope: text({ enum: VALID_DIRECTIVE_SCOPES }).notNull(),
    // PRD 0013: explicit category for renderer routing. Not NOT-NULL at the
    // SQL layer because SQLite cannot retro-fit it via ALTER TABLE without
    // recreating the table; the backfill migration populates every existing
    // row, and `createDirective` rejects null values from then on.
    category: text({ enum: VALID_DIRECTIVE_CATEGORIES }),
    title: text().notNull(),
    instruction: text().notNull(),
    kind: text({ enum: VALID_DIRECTIVE_KINDS }).notNull(),
    // Which repo a `kind: command` directive runs in. `auto` (default) targets
    // the modified repos, `all` every registered repo, `workspace` the
    // workspace root, or a specific `project_repo.name`.
    repoTarget: text().notNull().default("auto"),
    blocking: integer({ mode: "boolean" }).notNull().default(true),
    position: integer().notNull().default(0),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    lastRunAt: integer({ mode: "timestamp_ms" }),
    lastRunStatus: text({ enum: VALID_DIRECTIVE_RUN_STATUSES }),
    lastRunOutput: text(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("project_directives_project_scope_idx").on(
      table.projectId,
      table.scope,
      table.enabled,
      table.position,
    ),
  ],
);

// ── ADRs (architectural decision records) ─────────────────────────────────────
//
// First-order entity for architectural decisions tied to a project. Optionally
// linked to a logical PRD (`prdId`) — a decision can survive forks of the
// spec, so the link points to the logical PRD rather than `prd_revisions`.
//
// `number` is contiguous per project (1, 2, 3, …) and rendered as `ADR-0001`
// for humans. Allocation is atomic inside the domain layer (transaction +
// `SELECT MAX(number)+1`). The `id` stays a ULID for stable cross-table FKs.
//
// `supersededByAdrId` points to the newer ADR that replaced this one. When
// non-null, `status` is always `superseded`; the lifecycle transition is done
// atomically via `supersedeAdr`.

export const adrs = sqliteTable(
  "adrs",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    prdId: text().references(() => prds.id), // optional logical PRD that motivated the decision
    number: integer().notNull(), // contiguous per project (1, 2, 3, …); displayed as ADR-0001
    title: text().notNull(),
    status: text({ enum: VALID_ADR_STATUSES }).notNull().default("proposed"),
    body: text().notNull(), // markdown
    supersededByAdrId: text(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("adrs_project_id_idx").on(table.projectId),
    index("adrs_prd_id_idx").on(table.prdId),
    uniqueIndex("adrs_project_number_idx").on(table.projectId, table.number),
  ],
);

// ── Activity Log ──────────────────────────────────────────────────────────────

export const activityLog = sqliteTable(
  "activity_log",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId()),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    workspaceId: text().references(() => workspaces.id),
    // Revision-scoped: points to the prd_revision this event is about.
    prdRevisionId: text().references(() => prdRevisions.id),
    taskId: text().references(() => tasks.id),
    // Denormalised `project_repo.name` when the event is scoped to a specific
    // repo. Nullable: `null` means non-attributable (mono-repo project, or
    // legacy row predating multi-repo). Stored as a name rather than an FK so
    // attribution survives a later `removeRepo`. When `taskId` is set,
    // `logActivity` auto-resolves this from `task.repoId`.
    repoName: text(),
    eventType: text().notNull(),
    payload: text().notNull().default("{}"), // JSON
    source: text({ enum: VALID_ACTIVITY_SOURCES }).notNull().default("ai"),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("activity_log_project_id_idx").on(table.projectId),
    index("activity_log_workspace_id_idx").on(table.workspaceId),
    index("activity_log_prd_revision_id_idx").on(table.prdRevisionId),
    index("activity_log_task_id_idx").on(table.taskId),
    index("activity_log_repo_name_idx").on(table.projectId, table.repoName),
  ],
);

// ── Row types ─────────────────────────────────────────────────────────────────

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectRepoRow = typeof projectRepos.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type PrdRow = typeof prds.$inferSelect;
export type PrdRevisionRow = typeof prdRevisions.$inferSelect;
export type PrdRepoRow = typeof prdRepos.$inferSelect;
export type PrdTagRow = typeof prdTags.$inferSelect;
export type PrdAnnexRow = typeof prdAnnexes.$inferSelect;
export type PrdDependsOnRow = typeof prdDependsOn.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type ActivityRow = typeof activityLog.$inferSelect;
export type UserStoryRow = typeof userStories.$inferSelect;
export type TaskUserStoryRow = typeof taskUserStories.$inferSelect;
export type OutOfScopeItemRow = typeof outOfScopeItems.$inferSelect;
export type DocArtifactRow = typeof docArtifacts.$inferSelect;
export type DocProfileRow = typeof docProfiles.$inferSelect;
export type DocSyncRunRow = typeof docSyncRuns.$inferSelect;
export type ProjectConfigRow = typeof projectConfig.$inferSelect;
export type PendingActionRow = typeof pendingActions.$inferSelect;
export type ProjectDirectiveRow = typeof projectDirectives.$inferSelect;
export type AdrRow = typeof adrs.$inferSelect;

// ── Relations ─────────────────────────────────────────────────────────────────

export const relations = defineRelations(
  {
    projects,
    projectRepos,
    workspaces,
    prds,
    prdRevisions,
    prdRepos,
    prdTags,
    prdAnnexes,
    prdDependsOn,
    reviews,
    tasks,
    activityLog,
    userStories,
    taskUserStories,
    outOfScopeItems,
    docArtifacts,
    docProfiles,
    docSyncRuns,
    projectConfig,
    pendingActions,
    projectDirectives,
    adrs,
  },
  (r) => ({
    projects: {
      workspaces: r.many.workspaces({
        from: r.projects.id,
        to: r.workspaces.projectId,
      }),
      repos: r.many.projectRepos({
        from: r.projects.id,
        to: r.projectRepos.projectId,
      }),
      prds: r.many.prds({
        from: r.projects.id,
        to: r.prds.projectId,
      }),
      activityLogs: r.many.activityLog({
        from: r.projects.id,
        to: r.activityLog.projectId,
      }),
      adrs: r.many.adrs({
        from: r.projects.id,
        to: r.adrs.projectId,
      }),
    },
    projectRepos: {
      project: r.one.projects({
        from: r.projectRepos.projectId,
        to: r.projects.id,
      }),
    },
    workspaces: {
      project: r.one.projects({
        from: r.workspaces.projectId,
        to: r.projects.id,
      }),
      activityLogs: r.many.activityLog({
        from: r.workspaces.id,
        to: r.activityLog.workspaceId,
      }),
    },
    prds: {
      project: r.one.projects({
        from: r.prds.projectId,
        to: r.projects.id,
      }),
      revisions: r.many.prdRevisions({
        from: r.prds.id,
        to: r.prdRevisions.prdId,
      }),
      adrs: r.many.adrs({
        from: r.prds.id,
        to: r.adrs.prdId,
      }),
      tags: r.many.prdTags({
        from: r.prds.id,
        to: r.prdTags.prdId,
      }),
    },
    prdTags: {
      prd: r.one.prds({
        from: r.prdTags.prdId,
        to: r.prds.id,
      }),
    },
    adrs: {
      project: r.one.projects({
        from: r.adrs.projectId,
        to: r.projects.id,
      }),
      prd: r.one.prds({
        from: r.adrs.prdId,
        to: r.prds.id,
        optional: true,
      }),
    },
    prdRevisions: {
      prd: r.one.prds({
        from: r.prdRevisions.prdId,
        to: r.prds.id,
      }),
      project: r.one.projects({
        from: r.prdRevisions.projectId,
        to: r.projects.id,
      }),
      workspace: r.one.workspaces({
        from: r.prdRevisions.workspaceId,
        to: r.workspaces.id,
      }),
      tasks: r.many.tasks({
        from: r.prdRevisions.id,
        to: r.tasks.prdRevisionId,
      }),
      reviews: r.many.reviews({
        from: r.prdRevisions.id,
        to: r.reviews.prdRevisionId,
      }),
      activityLogs: r.many.activityLog({
        from: r.prdRevisions.id,
        to: r.activityLog.prdRevisionId,
      }),
      repos: r.many.prdRepos({
        from: r.prdRevisions.id,
        to: r.prdRepos.prdRevisionId,
      }),
      annexes: r.many.prdAnnexes({
        from: r.prdRevisions.id,
        to: r.prdAnnexes.prdRevisionId,
      }),
    },
    prdAnnexes: {
      prdRevision: r.one.prdRevisions({
        from: r.prdAnnexes.prdRevisionId,
        to: r.prdRevisions.id,
      }),
    },
    prdRepos: {
      prdRevision: r.one.prdRevisions({
        from: r.prdRepos.prdRevisionId,
        to: r.prdRevisions.id,
      }),
      repo: r.one.projectRepos({
        from: r.prdRepos.repoId,
        to: r.projectRepos.id,
      }),
    },
    prdDependsOn: {
      prd: r.one.prds({
        from: r.prdDependsOn.prdId,
        to: r.prds.id,
      }),
      dependsOnPrd: r.one.prds({
        from: r.prdDependsOn.dependsOnPrdId,
        to: r.prds.id,
      }),
    },
    reviews: {
      prdRevision: r.one.prdRevisions({
        from: r.reviews.prdRevisionId,
        to: r.prdRevisions.id,
      }),
      tasks: r.many.tasks({
        from: r.reviews.id,
        to: r.tasks.reviewId,
      }),
    },
    tasks: {
      prdRevision: r.one.prdRevisions({
        from: r.tasks.prdRevisionId,
        to: r.prdRevisions.id,
      }),
      review: r.one.reviews({
        from: r.tasks.reviewId,
        to: r.reviews.id,
      }),
      repo: r.one.projectRepos({
        from: r.tasks.repoId,
        to: r.projectRepos.id,
        optional: true,
      }),
      activityLogs: r.many.activityLog({
        from: r.tasks.id,
        to: r.activityLog.taskId,
      }),
    },
    activityLog: {
      project: r.one.projects({
        from: r.activityLog.projectId,
        to: r.projects.id,
      }),
      workspace: r.one.workspaces({
        from: r.activityLog.workspaceId,
        to: r.workspaces.id,
      }),
      prdRevision: r.one.prdRevisions({
        from: r.activityLog.prdRevisionId,
        to: r.prdRevisions.id,
      }),
      task: r.one.tasks({
        from: r.activityLog.taskId,
        to: r.tasks.id,
      }),
    },
  }),
);
