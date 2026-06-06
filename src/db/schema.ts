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
  VALID_FEEDBACK_STATUSES,
  VALID_IDEA_STATUSES,
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

// ── Design lock (PRD 0028) ──────────────────────────────────────────────────
//
// One row per prd_revision once its prototype design has been distilled. Kept
// OFF `prd_revisions` on purpose: parking the (potentially large) placement text
// and the marker here keeps them out of the core PRD row type that flows through
// the web/API. The `prd ready` design-lock gate checks for this row; the domain
// `distillDesign` upserts it.
export const prdDesignLock = sqliteTable("prd_design_lock", {
  prdRevisionId: text()
    .primaryKey()
    .references(() => prdRevisions.id),
  placementSpec: text().notNull(),
  distilledAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

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

// ── Page ↔ task link (PRD 0030 / issue 04) ────────────────────────────────────
//
// A plain M:N join — "this task realises these pages" — modeled exactly on
// `task_user_stories`. A page can be linked to several tasks and a task to
// several pages. The domain (`task-pages.ts`) keeps the cross-entity invariant
// the schema cannot express: a link is only allowed when the task and the page
// belong to the same PRD revision (the task via `task.prdRevisionId`, the page
// via its prototype's `prdRevisionId`). The link survives a PRD fork: `forkPrd`
// recreates each row remapping both ids to the fork's own task and page.
export const taskPrototypePages = sqliteTable(
  "task_prototype_pages",
  {
    taskId: text()
      .notNull()
      .references(() => tasks.id),
    pageId: text()
      .notNull()
      .references(() => prdPrototypePages.id),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.pageId] }),
    index("task_prototype_pages_page_idx").on(table.pageId),
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

// ── Prototypes (PRD 0025 / T1) ────────────────────────────────────────────────
//
// Hierarchy `Prototype → Page → Version → Variant`. A prototype groups every
// page the agent designs for a feature; a page is a logical screen (slug
// stable across renames); a version captures an iteration on a page; a variant
// is one concrete HTML rendering of a (page, version) — typically several
// when the agent wants the user to pick between layouts. Exactly one variant
// per page version carries `is_main = 1`.
//
// Feedbacks attach to a single variant. Status enum is intentionally just
// `open | ignored`: a "resolved" feedback is *derived* from "open feedback on a
// variant whose page now has a newer non-archived version", so the data model
// stays additive (versions are frozen). The `resolution_*` fields let the
// agent annotate the resolution for the audit log without flipping status.

export const prdPrototypes = sqliteTable(
  "prd_prototypes",
  {
    id: text().primaryKey(),
    prdRevisionId: text()
      .notNull()
      .references(() => prdRevisions.id),
    slug: text().notNull(),
    description: text(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    archivedAt: integer({ mode: "timestamp_ms" }),
  },
  (table) => [
    index("prd_prototypes_prd_revision_id_idx").on(table.prdRevisionId),
    uniqueIndex("prd_prototypes_prd_revision_slug_idx").on(table.prdRevisionId, table.slug),
  ],
);

export const prdPrototypePages = sqliteTable(
  "prd_prototype_pages",
  {
    id: text().primaryKey(),
    prototypeId: text()
      .notNull()
      .references(() => prdPrototypes.id),
    slug: text().notNull(),
    title: text().notNull(),
    position: integer().notNull().default(0),
    // Election (PRD 0028): the single variant chosen for implementation on this
    // page, distinct from per-version `is_main` (a within-tree primacy hint).
    // Set via `electVariant`; the rationale / who / when form the arbitration
    // record the dev handoff relies on. Null until the design is locked.
    //
    // Stored as a plain id, NOT a foreign key: a `references(() =>
    // prdPrototypeVariants.id)` would close a cycle (pages → variants → versions
    // → pages) that degrades Drizzle's `.returning()` inference across the whole
    // prototype graph. Integrity is kept in the domain instead — `electVariant`
    // validates the variant exists, and `removeVariant` clears a dangling choice.
    chosenVariantId: text(),
    decisionRationale: text(),
    decidedBy: text(),
    decidedAt: integer({ mode: "timestamp_ms" }),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("prd_prototype_pages_prototype_id_idx").on(table.prototypeId),
    uniqueIndex("prd_prototype_pages_prototype_slug_idx").on(table.prototypeId, table.slug),
  ],
);

export const prdPrototypePageVersions = sqliteTable(
  "prd_prototype_page_versions",
  {
    id: text().primaryKey(),
    pageId: text()
      .notNull()
      .references(() => prdPrototypePages.id),
    label: text().notNull(),
    summary: text(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    archivedAt: integer({ mode: "timestamp_ms" }),
  },
  (table) => [
    index("prd_prototype_page_versions_page_id_idx").on(table.pageId),
    uniqueIndex("prd_prototype_page_versions_page_label_idx").on(table.pageId, table.label),
  ],
);

export const prdPrototypeVariants = sqliteTable(
  "prd_prototype_variants",
  {
    id: text().primaryKey(),
    pageVersionId: text()
      .notNull()
      .references(() => prdPrototypePageVersions.id),
    label: text().notNull(),
    title: text().notNull(),
    htmlContent: text().notNull(),
    isMain: integer({ mode: "boolean" }).notNull().default(false),
    position: integer().notNull().default(0),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("prd_prototype_variants_page_version_id_idx").on(table.pageVersionId),
    uniqueIndex("prd_prototype_variants_page_version_label_idx").on(
      table.pageVersionId,
      table.label,
    ),
  ],
);

export const prdPrototypeFeedback = sqliteTable(
  "prd_prototype_feedback",
  {
    id: text().primaryKey(),
    variantId: text()
      .notNull()
      .references(() => prdPrototypeVariants.id),
    text: text().notNull(),
    // CSS selector captured by the in-iframe shim when the user clicked an
    // element in "pin" mode. Nullable for free-form global feedbacks.
    selectorCss: text(),
    status: text({ enum: VALID_FEEDBACK_STATUSES }).notNull().default("open"),
    // `resolution_*` are optional annotations the agent fills in when it
    // addresses a feedback by creating a new version/variant. Status stays
    // `open` — the derived "addressed" bucket is computed at read time.
    resolutionNote: text(),
    resolutionViaVariantId: text(),
    resolvedAt: integer({ mode: "timestamp_ms" }),
    // `ignored_reason` is required at the domain layer whenever status flips
    // to `ignored` — without a stated reason the audit log loses its value.
    ignoredReason: text(),
    ignoredAt: integer({ mode: "timestamp_ms" }),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("prd_prototype_feedback_variant_id_idx").on(table.variantId),
    index("prd_prototype_feedback_variant_status_idx").on(table.variantId, table.status),
  ],
);

// ── Prototype rounds (PRD 0029 / Tranche A) ───────────────────────────────────
//
// A *round* is a whole-design round: a named, manifest-pinned snapshot of
// which page version ships together. It is orthogonal to a per-page `version`
// (a single page's iteration). Membership is *row presence* in the manifest —
// a page absent from `prd_prototype_round_pages` is simply not part of that
// round. The "current" round is the one with the maximum `position` and is
// the only mutable one; earlier rounds are frozen by construction (callers
// never re-pin them). `createPrototype` seeds an empty `v1` round.
//
// Neither table closes the `pages → variants → versions → pages` cycle, so
// these FKs preserve Drizzle's `.returning()` inference on the prototype graph.

export const prdPrototypeRounds = sqliteTable(
  "prd_prototype_rounds",
  {
    id: text().primaryKey(),
    prototypeId: text()
      .notNull()
      .references(() => prdPrototypes.id),
    label: text().notNull(),
    summary: text(),
    position: integer().notNull().default(0),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("prd_prototype_rounds_prototype_id_idx").on(table.prototypeId),
    uniqueIndex("prd_prototype_rounds_prototype_label_idx").on(table.prototypeId, table.label),
  ],
);

export const prdPrototypeRoundPages = sqliteTable(
  "prd_prototype_round_pages",
  {
    id: text().primaryKey(),
    roundId: text()
      .notNull()
      .references(() => prdPrototypeRounds.id),
    pageId: text()
      .notNull()
      .references(() => prdPrototypePages.id),
    pageVersionId: text()
      .notNull()
      .references(() => prdPrototypePageVersions.id),
    position: integer().notNull().default(0),
    // Election (PRD 0030): the variant chosen for this page *in this round*,
    // moved here from `prd_prototype_pages` so each round carries its own
    // decision (re-opening/cloning a round no longer drags a stale choice).
    // Inherited when a round is cloned; reset when the page's pinned version
    // advances (the decision was about the old variant).
    //
    // Stored as a plain id, NOT a foreign key — same rationale as the page's
    // legacy `chosen_variant_id`: an FK would close a pages → variants →
    // versions → pages cycle that degrades Drizzle's `.returning()` inference.
    // Integrity is kept in the domain (`electVariant` validates the variant,
    // `removeVariant` clears a dangling choice).
    chosenVariantId: text(),
    decisionRationale: text(),
    decidedBy: text(),
    decidedAt: integer({ mode: "timestamp_ms" }),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("prd_prototype_round_pages_round_id_idx").on(table.roundId),
    index("prd_prototype_round_pages_page_id_idx").on(table.pageId),
    uniqueIndex("prd_prototype_round_pages_round_page_idx").on(table.roundId, table.pageId),
  ],
);

// ── Round-page placement (PRD 0030 / issue 02) ────────────────────────────────
//
// The distilled placement spec for a `(round, page)` — the validated layout the
// dev/coder implements. Kept in its own table, OUT of the manifest hot path
// (`prd_prototype_round_pages`), so the potentially large markdown is loaded
// only when distilling or rendering the coder context, never on every round
// render. One row per `(round, page)`; authored on the fly as soon as the page's
// variant is decided in the round, reset (row removed) when the page's pinned
// version advances — mirroring the round-scoped election.
//
// `roundId` / `pageId` are FKs (they do not close the prototype-graph cycle).
// `placementSpec` is one markdown field, structured by convention (Regions /
// Order / Hierarchy / States / Interactions); the section guard lives in the
// domain (`distillPagePlacement`).
export const prdRoundPageDesign = sqliteTable(
  "prd_round_page_design",
  {
    roundId: text()
      .notNull()
      .references(() => prdPrototypeRounds.id),
    pageId: text()
      .notNull()
      .references(() => prdPrototypePages.id),
    placementSpec: text().notNull(),
    distilledAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.pageId] }),
    index("prd_round_page_design_page_id_idx").on(table.pageId),
  ],
);

// ── Ideas (PRD 0027 / T1) ─────────────────────────────────────────────────────
//
// A deliberately thin, project-scoped capture entity that sits *before* the
// commitment a PRD represents. An idea is just title + optional markdown body +
// optional tag. Its lifecycle is a triage machine (`open → promoted | dropped`,
// `dropped → open`), not a commitment machine — see PRD 0027 and the ADR it
// records. The two couplings to the committed world are both narrow and
// explicit: `promotedPrdId` (provenance — "which PRD did this become?", set
// once by `promote`, references the *logical* PRD so it survives forks) and the
// `prd_ideas` reference join below (source material — "which ideas motivated
// this PRD?").

export const ideas = sqliteTable(
  "ideas",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    title: text().notNull(),
    body: text(), // optional markdown
    tag: text(), // optional, kebab-case (single)
    status: text({ enum: VALID_IDEA_STATUSES }).notNull().default("open"),
    promotedPrdId: text().references(() => prds.id), // set on promote (logical PRD)
    droppedReason: text(), // optional
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("ideas_project_id_idx").on(table.projectId),
    index("ideas_project_status_idx").on(table.projectId, table.status),
    index("ideas_promoted_prd_id_idx").on(table.promotedPrdId),
  ],
);

// ── PRD ↔ idea reference join (M:N) ───────────────────────────────────────────
//
// Records which source ideas motivated a PRD. Modeled on `prd_tags` /
// `prd_depends_on`: attached to the *logical* PRD (`prds.id`) so the linkage
// survives forks like tags and dependencies. Referencing an idea here does NOT
// change its status — a parked `open` idea can inform a PRD without being
// consumed; `promote` is the only path that flips an idea to `promoted`.

export const prdIdeas = sqliteTable(
  "prd_ideas",
  {
    prdId: text()
      .notNull()
      .references(() => prds.id), // logical PRD
    ideaId: text()
      .notNull()
      .references(() => ideas.id),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.prdId, table.ideaId] }),
    index("prd_ideas_idea_id_idx").on(table.ideaId),
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
export type TaskPrototypePageRow = typeof taskPrototypePages.$inferSelect;
export type OutOfScopeItemRow = typeof outOfScopeItems.$inferSelect;
export type DocArtifactRow = typeof docArtifacts.$inferSelect;
export type DocProfileRow = typeof docProfiles.$inferSelect;
export type DocSyncRunRow = typeof docSyncRuns.$inferSelect;
export type ProjectConfigRow = typeof projectConfig.$inferSelect;
export type PendingActionRow = typeof pendingActions.$inferSelect;
export type ProjectDirectiveRow = typeof projectDirectives.$inferSelect;
export type AdrRow = typeof adrs.$inferSelect;
export type PrdPrototypeRow = typeof prdPrototypes.$inferSelect;
export type PrdPrototypePageRow = typeof prdPrototypePages.$inferSelect;
export type PrdPrototypePageVersionRow = typeof prdPrototypePageVersions.$inferSelect;
export type PrdPrototypeVariantRow = typeof prdPrototypeVariants.$inferSelect;
export type PrdPrototypeFeedbackRow = typeof prdPrototypeFeedback.$inferSelect;
export type PrdPrototypeRoundRow = typeof prdPrototypeRounds.$inferSelect;
export type PrdPrototypeRoundPageRow = typeof prdPrototypeRoundPages.$inferSelect;
export type PrdRoundPageDesignRow = typeof prdRoundPageDesign.$inferSelect;
export type IdeaRow = typeof ideas.$inferSelect;
export type PrdIdeaRow = typeof prdIdeas.$inferSelect;

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
    taskPrototypePages,
    outOfScopeItems,
    docArtifacts,
    docProfiles,
    docSyncRuns,
    projectConfig,
    pendingActions,
    projectDirectives,
    adrs,
    prdPrototypes,
    prdPrototypePages,
    prdPrototypePageVersions,
    prdPrototypeVariants,
    prdPrototypeFeedback,
    prdPrototypeRounds,
    prdPrototypeRoundPages,
    prdRoundPageDesign,
    ideas,
    prdIdeas,
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
      ideas: r.many.ideas({
        from: r.projects.id,
        to: r.ideas.projectId,
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
      prototypes: r.many.prdPrototypes({
        from: r.prdRevisions.id,
        to: r.prdPrototypes.prdRevisionId,
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
    prdPrototypes: {
      prdRevision: r.one.prdRevisions({
        from: r.prdPrototypes.prdRevisionId,
        to: r.prdRevisions.id,
      }),
      pages: r.many.prdPrototypePages({
        from: r.prdPrototypes.id,
        to: r.prdPrototypePages.prototypeId,
      }),
      rounds: r.many.prdPrototypeRounds({
        from: r.prdPrototypes.id,
        to: r.prdPrototypeRounds.prototypeId,
      }),
    },
    prdPrototypePages: {
      prototype: r.one.prdPrototypes({
        from: r.prdPrototypePages.prototypeId,
        to: r.prdPrototypes.id,
      }),
      versions: r.many.prdPrototypePageVersions({
        from: r.prdPrototypePages.id,
        to: r.prdPrototypePageVersions.pageId,
      }),
    },
    prdPrototypePageVersions: {
      page: r.one.prdPrototypePages({
        from: r.prdPrototypePageVersions.pageId,
        to: r.prdPrototypePages.id,
      }),
      variants: r.many.prdPrototypeVariants({
        from: r.prdPrototypePageVersions.id,
        to: r.prdPrototypeVariants.pageVersionId,
      }),
    },
    prdPrototypeVariants: {
      pageVersion: r.one.prdPrototypePageVersions({
        from: r.prdPrototypeVariants.pageVersionId,
        to: r.prdPrototypePageVersions.id,
      }),
      feedback: r.many.prdPrototypeFeedback({
        from: r.prdPrototypeVariants.id,
        to: r.prdPrototypeFeedback.variantId,
      }),
    },
    prdPrototypeFeedback: {
      variant: r.one.prdPrototypeVariants({
        from: r.prdPrototypeFeedback.variantId,
        to: r.prdPrototypeVariants.id,
      }),
    },
    prdPrototypeRounds: {
      prototype: r.one.prdPrototypes({
        from: r.prdPrototypeRounds.prototypeId,
        to: r.prdPrototypes.id,
      }),
      pages: r.many.prdPrototypeRoundPages({
        from: r.prdPrototypeRounds.id,
        to: r.prdPrototypeRoundPages.roundId,
      }),
    },
    prdPrototypeRoundPages: {
      round: r.one.prdPrototypeRounds({
        from: r.prdPrototypeRoundPages.roundId,
        to: r.prdPrototypeRounds.id,
      }),
      page: r.one.prdPrototypePages({
        from: r.prdPrototypeRoundPages.pageId,
        to: r.prdPrototypePages.id,
      }),
      pageVersion: r.one.prdPrototypePageVersions({
        from: r.prdPrototypeRoundPages.pageVersionId,
        to: r.prdPrototypePageVersions.id,
      }),
    },
    prdRoundPageDesign: {
      round: r.one.prdPrototypeRounds({
        from: r.prdRoundPageDesign.roundId,
        to: r.prdPrototypeRounds.id,
      }),
      page: r.one.prdPrototypePages({
        from: r.prdRoundPageDesign.pageId,
        to: r.prdPrototypePages.id,
      }),
    },
    ideas: {
      project: r.one.projects({
        from: r.ideas.projectId,
        to: r.projects.id,
      }),
      promotedPrd: r.one.prds({
        from: r.ideas.promotedPrdId,
        to: r.prds.id,
        optional: true,
      }),
    },
    prdIdeas: {
      prd: r.one.prds({
        from: r.prdIdeas.prdId,
        to: r.prds.id,
      }),
      idea: r.one.ideas({
        from: r.prdIdeas.ideaId,
        to: r.ideas.id,
      }),
    },
  }),
);
