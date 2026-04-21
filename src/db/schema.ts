import { defineRelations } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import {
  VALID_PROJECT_STATUSES,
  VALID_PRD_STATUSES,
  VALID_TASK_DESCRIPTION_FORMATS,
  VALID_TASK_STATUSES,
  VALID_EFFORTS,
} from "#/lib/validator";

// ── Projects ──────────────────────────────────────────────────────────────────

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), // ULID
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", { enum: VALID_PROJECT_STATUSES })
    .notNull()
    .default("active"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ── Workspaces ────────────────────────────────────────────────────────────────

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(), // ULID
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  path: text("path").notNull().unique(), // canonical absolute path
  label: text("label"), // optional human label
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ── PRDs ──────────────────────────────────────────────────────────────────────

export const prds = sqliteTable("prds", {
  id: text("id").primaryKey(), // ULID
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  parentId: text("parent_id"), // set when created via `prd amend`
  revision: integer("revision").notNull().default(1),
  title: text("title").notNull(),
  context: text("context"), // why this PRD exists
  scope: text("scope"), // what is included and excluded
  status: text("status", { enum: VALID_PRD_STATUSES })
    .notNull()
    .default("draft"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  committedAt: text("committed_at"),
  activatedAt: text("activated_at"),
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), // ULID
  prdId: text("prd_id")
    .notNull()
    .references(() => prds.id),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  descriptionFormat: text("description_format", { enum: VALID_TASK_DESCRIPTION_FORMATS })
    .notNull()
    .default("legacy"),
  doneCriteria: text("done_criteria").notNull(), // textual, non-empty
  dependsOn: text("depends_on").notNull().default("[]"), // JSON array of task ids
  effort: text("effort", { enum: VALID_EFFORTS }).notNull(),
  status: text("status", { enum: VALID_TASK_STATUSES })
    .notNull()
    .default("pending"),
  blockedReason: text("blocked_reason"), // required when status = blocked
  skipReason: text("skip_reason"), // required when status = skipped
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});

// ── Activity Log ──────────────────────────────────────────────────────────────

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  prdId: text("prd_id").references(() => prds.id),
  taskId: text("task_id").references(() => tasks.id),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull().default("{}"), // JSON
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

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
