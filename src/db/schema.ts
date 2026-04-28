import { defineRelations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  VALID_EFFORTS,
  VALID_PRD_STATUSES,
  VALID_PROJECT_STATUSES,
  VALID_REVIEW_STATUSES,
  VALID_REVIEW_TYPES,
  VALID_SEVERITY_LEVELS,
  VALID_TASK_DESCRIPTION_FORMATS,
  VALID_TASK_STATUSES,
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
    status: text({ enum: VALID_PRD_STATUSES }).notNull().default("draft"),
    auditCycles: integer().notNull().default(0),
    currentPhase: integer(), // null = single-phase; >= 1 = current phase number
    supersededAt: integer({ mode: "timestamp_ms" }), // set when a fork creates a newer revision
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
    phaseNumber: integer(), // which phase this task belongs to; null = single-phase PRD
    status: text({ enum: VALID_TASK_STATUSES }).notNull().default("pending"),
    reviewId: text().references(() => reviews.id), // set when task belongs to a review
    severity: text({ enum: VALID_SEVERITY_LEVELS }), // relevant when reviewId is set
    blockedReason: text(), // required when status = blocked
    skipReason: text(), // required when status = skipped
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
    eventType: text().notNull(),
    payload: text().notNull().default("{}"), // JSON
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("activity_log_project_id_idx").on(table.projectId),
    index("activity_log_workspace_id_idx").on(table.workspaceId),
    index("activity_log_prd_revision_id_idx").on(table.prdRevisionId),
    index("activity_log_task_id_idx").on(table.taskId),
  ],
);

// ── Row types ─────────────────────────────────────────────────────────────────

export type ProjectRow = typeof projects.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type PrdRow = typeof prds.$inferSelect;
export type PrdRevisionRow = typeof prdRevisions.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type ActivityRow = typeof activityLog.$inferSelect;

// ── Relations ─────────────────────────────────────────────────────────────────

export const relations = defineRelations(
  { projects, workspaces, prds, prdRevisions, reviews, tasks, activityLog },
  (r) => ({
    projects: {
      workspaces: r.many.workspaces({
        from: r.projects.id,
        to: r.workspaces.projectId,
      }),
      prds: r.many.prds({
        from: r.projects.id,
        to: r.prds.projectId,
      }),
      activityLogs: r.many.activityLog({
        from: r.projects.id,
        to: r.activityLog.projectId,
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
