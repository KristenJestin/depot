import { defineRelations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  VALID_EFFORTS,
  VALID_PRD_STATUSES,
  VALID_PROJECT_STATUSES,
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

// ── PRDs ──────────────────────────────────────────────────────────────────────

export const prds = sqliteTable(
  "prds",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    workspaceId: text().references(() => workspaces.id), // set at activation, null until then
    parentId: text().references((): AnySQLiteColumn => prds.id), // set when created via `prd fork`
    revision: integer().notNull().default(1),
    title: text().notNull(),
    context: text(), // why this PRD exists
    scope: text(), // what is included and excluded
    status: text({ enum: VALID_PRD_STATUSES }).notNull().default("draft"),
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
    index("prds_project_id_idx").on(table.projectId),
    index("prds_workspace_id_idx").on(table.workspaceId),
    index("prds_parent_id_idx").on(table.parentId),
  ],
);

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
  "tasks",
  {
    id: text().primaryKey(),
    prdId: text()
      .notNull()
      .references(() => prds.id),
    position: integer().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    descriptionFormat: text({ enum: VALID_TASK_DESCRIPTION_FORMATS })
      .notNull()
      .default("structured_v1"),
    doneCriteria: text().notNull(), // textual, non-empty
    dependsOn: text().notNull().default("[]"), // JSON array of task ids
    effort: text({ enum: VALID_EFFORTS }).notNull(),
    status: text({ enum: VALID_TASK_STATUSES }).notNull().default("pending"),
    blockedReason: text(), // required when status = blocked
    skipReason: text(), // required when status = skipped
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    startedAt: integer({ mode: "timestamp_ms" }),
    completedAt: integer({ mode: "timestamp_ms" }),
  },
  (table) => [index("tasks_prd_id_idx").on(table.prdId)],
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
    prdId: text().references(() => prds.id),
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
    index("activity_log_prd_id_idx").on(table.prdId),
    index("activity_log_task_id_idx").on(table.taskId),
  ],
);

// ── Row types ─────────────────────────────────────────────────────────────────

export type ProjectRow = typeof projects.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type PrdRow = typeof prds.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type ActivityRow = typeof activityLog.$inferSelect;

// ── Relations ─────────────────────────────────────────────────────────────────

export const relations = defineRelations(
  { projects, workspaces, prds, tasks, activityLog },
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
      prds: r.many.prds({
        from: r.workspaces.id,
        to: r.prds.workspaceId,
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
      workspace: r.one.workspaces({
        from: r.prds.workspaceId,
        to: r.workspaces.id,
      }),
      parent: r.one.prds({
        from: r.prds.parentId,
        to: r.prds.id,
        alias: "prd_parent",
      }),
      tasks: r.many.tasks({
        from: r.prds.id,
        to: r.tasks.prdId,
      }),
      activityLogs: r.many.activityLog({
        from: r.prds.id,
        to: r.activityLog.prdId,
      }),
    },
    tasks: {
      prd: r.one.prds({
        from: r.tasks.prdId,
        to: r.prds.id,
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
      prd: r.one.prds({
        from: r.activityLog.prdId,
        to: r.prds.id,
      }),
      task: r.one.tasks({
        from: r.activityLog.taskId,
        to: r.tasks.id,
      }),
    },
  }),
);
