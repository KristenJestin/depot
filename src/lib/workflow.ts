import { eq } from "drizzle-orm";
import { projects, workspaces, prds, tasks, activityLog } from "#/db/schema";
import { generateId } from "#/lib/ids";
import type { Database } from "#/db/client";
import type { Effort } from "#/lib/validator";
import { normalizeWorkspacePath } from "#/lib/paths";

// ── Projects ──────────────────────────────────────────────────────────────────

export async function createProject(db: Database, input: { name: string; description?: string }) {
  const id = generateId();
  const now = new Date().toISOString();
  await db.insert(projects).values({
    id,
    name: input.name,
    description: input.description ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const row = await db.query.projects.findFirst({ where: { id } });
  return row!;
}

export async function listProjects(db: Database) {
  return db.query.projects.findMany({
    orderBy: { createdAt: "asc" },
  });
}

export async function getProject(db: Database, id: string) {
  return db.query.projects.findFirst({ where: { id } }) ?? null;
}

// ── Workspaces ────────────────────────────────────────────────────────────────

export async function addWorkspace(
  db: Database,
  input: { projectId: string; path: string; label?: string },
) {
  const id = generateId();
  const now = new Date().toISOString();
  const canonicalPath = normalizeWorkspacePath(input.path);
  await db.insert(workspaces).values({
    id,
    projectId: input.projectId,
    path: canonicalPath,
    label: input.label ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const row = await db.query.workspaces.findFirst({ where: { id } });
  return row!;
}

/**
 * Resolve the current workspace using longest-prefix matching on canonical paths.
 * Commands run from any nested subdirectory resolve to the correct workspace.
 */
export async function resolveWorkspace(db: Database, currentPath: string) {
  const allWorkspaces = await db.query.workspaces.findMany();
  const canonicalCurrentPath = normalizeWorkspacePath(currentPath);

  // Longest-prefix matching: find the workspace whose path is the longest
  // prefix of the current path.
  let bestMatch: (typeof allWorkspaces)[number] | null = null;
  let bestLen = 0;

  for (const ws of allWorkspaces) {
    const wsPath = normalizeWorkspacePath(ws.path);
    if (
      canonicalCurrentPath === wsPath ||
      canonicalCurrentPath.startsWith(wsPath + "/")
    ) {
      if (wsPath.length > bestLen) {
        bestLen = wsPath.length;
        bestMatch = ws;
      }
    }
  }

  return bestMatch;
}

export async function updateWorkspacePath(db: Database, workspaceId: string, newPath: string) {
  await db
    .update(workspaces)
    .set({
      path: normalizeWorkspacePath(newPath),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(workspaces.id, workspaceId));
  return db.query.workspaces.findFirst({ where: { id: workspaceId } });
}

// ── PRDs ──────────────────────────────────────────────────────────────────────

export async function createPrd(
  db: Database,
  input: {
    projectId: string;
    workspaceId: string;
    title: string;
    context?: string;
    scope?: string;
  },
) {
  const id = generateId();
  const now = new Date().toISOString();
  await db.insert(prds).values({
    id,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    parentId: null,
    revision: 1,
    title: input.title,
    context: input.context ?? null,
    scope: input.scope ?? null,
    status: "draft",
    createdAt: now,
    committedAt: null,
    activatedAt: null,
  });
  const row = await db.query.prds.findFirst({ where: { id } });
  return row!;
}

export async function getPrd(db: Database, id: string) {
  return (await db.query.prds.findFirst({ where: { id } })) ?? null;
}

export async function listPrds(
  db: Database,
  filter: { projectId?: string; workspaceId?: string } = {},
) {
  // Use query builder for conditional filtering
  if (filter.workspaceId) {
    return db.query.prds.findMany({
      where: { workspaceId: filter.workspaceId },
      orderBy: { createdAt: "asc" },
    });
  }
  if (filter.projectId) {
    return db.query.prds.findMany({
      where: { projectId: filter.projectId },
      orderBy: { createdAt: "asc" },
    });
  }
  return db.query.prds.findMany({ orderBy: { createdAt: "asc" } });
}

export async function commitPrd(db: Database, id: string) {
  const prd = await getPrd(db, id);
  if (!prd) throw new Error(`PRD not found: ${id}`);
  if (prd.status !== "draft") {
    throw new Error(`Cannot commit PRD: status is '${prd.status}', expected 'draft'`);
  }
  const now = new Date().toISOString();
  await db
    .update(prds)
    .set({ status: "committed", committedAt: now, updatedAt: now } as any)
    .where(eq(prds.id, id));
  return (await getPrd(db, id))!;
}

export async function activatePrd(db: Database, id: string) {
  const prd = await getPrd(db, id);
  if (!prd) throw new Error(`PRD not found: ${id}`);
  if (prd.status !== "committed") {
    throw new Error(`Cannot activate PRD: status is '${prd.status}', expected 'committed'`);
  }
  const activePrd = await db.query.prds.findFirst({
    where: { workspaceId: prd.workspaceId, status: "in_progress" },
  });
  if (activePrd && activePrd.id !== id) {
    throw new Error(
      `Cannot activate PRD: workspace already has active PRD '${activePrd.id}'`,
    );
  }
  const now = new Date().toISOString();
  await db
    .update(prds)
    .set({ status: "in_progress", activatedAt: now, updatedAt: now } as any)
    .where(eq(prds.id, id));
  return (await getPrd(db, id))!;
}

export async function archivePrd(db: Database, id: string) {
  const prd = await getPrd(db, id);
  if (!prd) throw new Error(`PRD not found: ${id}`);
  if (prd.status !== "in_progress" && prd.status !== "committed") {
    throw new Error(
      `Cannot archive PRD: status is '${prd.status}', expected 'in_progress' or 'committed'`,
    );
  }
  await db
    .update(prds)
    .set({ status: "archived", updatedAt: new Date().toISOString() } as any)
    .where(eq(prds.id, id));
  return (await getPrd(db, id))!;
}

/**
 * Amend a committed or in_progress PRD by creating a new revision.
 * The original PRD is archived.
 */
export async function amendPrd(
  db: Database,
  id: string,
  changes: { title?: string; context?: string; scope?: string },
) {
  const original = await getPrd(db, id);
  if (!original) throw new Error(`PRD not found: ${id}`);
  if (original.status !== "committed" && original.status !== "in_progress") {
    throw new Error(
      `Cannot amend PRD: status is '${original.status}', expected 'committed' or 'in_progress'`,
    );
  }

  // Archive the original revision
  await db
    .update(prds)
    .set({ status: "archived", updatedAt: new Date().toISOString() } as any)
    .where(eq(prds.id, id));

  // Create the next revision
  const newId = generateId();
  const now = new Date().toISOString();
  await db.insert(prds).values({
    id: newId,
    projectId: original.projectId,
    workspaceId: original.workspaceId,
    parentId: original.id,
    revision: original.revision + 1,
    title: changes.title ?? original.title,
    context: changes.context ?? original.context,
    scope: changes.scope ?? original.scope,
    status: "draft",
    createdAt: now,
    committedAt: null,
    activatedAt: null,
  });
  return (await getPrd(db, newId))!;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function createTask(
  db: Database,
  input: {
    prdId: string;
    title: string;
    description: string;
    doneCriteria: string;
    effort: Effort;
    dependsOn?: string[];
  },
) {
  if (!input.doneCriteria || input.doneCriteria.trim() === "") {
    throw new Error("Task must have non-empty done_criteria");
  }

  // Determine next position within the PRD
  const existing = await db.query.tasks.findMany({
    where: { prdId: input.prdId },
  });
  const nextPosition = existing.length + 1;

  const id = generateId();
  const now = new Date().toISOString();
  await db.insert(tasks).values({
    id,
    prdId: input.prdId,
    position: nextPosition,
    title: input.title,
    description: input.description,
    doneCriteria: input.doneCriteria,
    dependsOn: JSON.stringify(input.dependsOn ?? []),
    effort: input.effort,
    status: "pending",
    blockedReason: null,
    skipReason: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  });
  return (await getTask(db, id))!;
}

export async function getTask(db: Database, id: string) {
  return (await db.query.tasks.findFirst({ where: { id } })) ?? null;
}

export async function listTasks(db: Database, prdId: string) {
  return db.query.tasks.findMany({
    where: { prdId },
    orderBy: { position: "asc" },
  });
}

export async function startTask(db: Database, id: string) {
  const task = await getTask(db, id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.status !== "pending") {
    throw new Error(`Cannot start task: status is '${task.status}', expected 'pending'`);
  }
  const now = new Date().toISOString();
  await db.update(tasks).set({ status: "in_progress", startedAt: now }).where(eq(tasks.id, id));
  return (await getTask(db, id))!;
}

/**
 * Complete an in_progress task.
 * Enforces mechanical checks:
 * - Task is currently in_progress
 * - All dependency tasks have status 'done'
 * - done_criteria is non-empty
 * - started_at is set
 */
export async function completeTask(db: Database, id: string) {
  const task = await getTask(db, id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.status !== "in_progress") {
    throw new Error(`Cannot complete task: status is '${task.status}', expected 'in_progress'`);
  }
  if (!task.startedAt) {
    throw new Error("Cannot complete task: started_at is not set");
  }
  if (!task.doneCriteria || task.doneCriteria.trim() === "") {
    throw new Error("Cannot complete task: done_criteria is empty");
  }

  // Verify all declared dependencies are done
  const deps: string[] = JSON.parse(task.dependsOn);
  if (deps.length > 0) {
    for (const depId of deps) {
      const dep = await getTask(db, depId);
      if (!dep) {
        throw new Error(`Dependency task not found: ${depId}`);
      }
      if (dep.status !== "done") {
        throw new Error(
          `Cannot complete task: dependency '${depId}' is not done (status: '${dep.status}')`,
        );
      }
    }
  }

  const now = new Date().toISOString();
  await db.update(tasks).set({ status: "done", completedAt: now }).where(eq(tasks.id, id));
  return (await getTask(db, id))!;
}

export async function blockTask(db: Database, id: string, reason: string) {
  if (!reason || reason.trim() === "") {
    throw new Error("Block reason is required");
  }
  const task = await getTask(db, id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.status !== "in_progress") {
    throw new Error(`Cannot block task: status is '${task.status}', expected 'in_progress'`);
  }
  await db.update(tasks).set({ status: "blocked", blockedReason: reason }).where(eq(tasks.id, id));
  return (await getTask(db, id))!;
}

export async function skipTask(db: Database, id: string, reason: string) {
  if (!reason || reason.trim() === "") {
    throw new Error("Skip reason is required");
  }
  const task = await getTask(db, id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.status !== "pending" && task.status !== "blocked") {
    throw new Error(
      `Cannot skip task: status is '${task.status}', expected 'pending' or 'blocked'`,
    );
  }
  const now = new Date().toISOString();
  await db
    .update(tasks)
    .set({ status: "skipped", skipReason: reason, completedAt: now })
    .where(eq(tasks.id, id));
  return (await getTask(db, id))!;
}

// ── Activity Log ──────────────────────────────────────────────────────────────

export async function logActivity(
  db: Database,
  input: {
    projectId: string;
    workspaceId?: string;
    prdId?: string;
    taskId?: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
) {
  const project = await getProject(db, input.projectId);
  if (!project) {
    throw new Error(`Project not found: ${input.projectId}`);
  }

  let workspace = null;
  if (input.workspaceId) {
    workspace = await db.query.workspaces.findFirst({ where: { id: input.workspaceId } });
    if (!workspace) {
      throw new Error(`Workspace not found: ${input.workspaceId}`);
    }
    if (workspace.projectId !== input.projectId) {
      throw new Error(`Workspace '${input.workspaceId}' does not belong to project '${input.projectId}'`);
    }
  }

  let prd = null;
  if (input.prdId) {
    prd = await getPrd(db, input.prdId);
    if (!prd) {
      throw new Error(`PRD not found: ${input.prdId}`);
    }
    if (prd.projectId !== input.projectId) {
      throw new Error(`PRD '${input.prdId}' does not belong to project '${input.projectId}'`);
    }
    if (workspace && prd.workspaceId !== workspace.id) {
      throw new Error(`PRD '${input.prdId}' does not belong to workspace '${workspace.id}'`);
    }
  }

  if (input.taskId) {
    const task = await getTask(db, input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }
    const taskPrd = prd && prd.id === task.prdId ? prd : await getPrd(db, task.prdId);
    if (!taskPrd) {
      throw new Error(`PRD not found for task '${input.taskId}'`);
    }
    if (taskPrd.projectId !== input.projectId) {
      throw new Error(`Task '${input.taskId}' does not belong to project '${input.projectId}'`);
    }
    if (workspace && taskPrd.workspaceId !== workspace.id) {
      throw new Error(`Task '${input.taskId}' does not belong to workspace '${workspace.id}'`);
    }
    if (prd && taskPrd.id !== prd.id) {
      throw new Error(`Task '${input.taskId}' does not belong to PRD '${prd.id}'`);
    }
  }

  const now = new Date().toISOString();
  const result = await db
    .insert(activityLog)
    .values({
      projectId: input.projectId,
      workspaceId: input.workspaceId ?? null,
      prdId: input.prdId ?? null,
      taskId: input.taskId ?? null,
      eventType: input.eventType,
      payload: JSON.stringify(input.payload),
      createdAt: now,
    })
    .returning();
  return result[0]!;
}

export async function listActivity(
  db: Database,
  filter: { projectId: string; workspaceId?: string; limit?: number },
) {
  const where = filter.workspaceId
    ? { projectId: filter.projectId, workspaceId: filter.workspaceId }
    : { projectId: filter.projectId };

  const rows = await db.query.activityLog.findMany({
    where,
    orderBy: { id: "desc" },
    limit: filter.limit,
  });
  return rows.reverse();
}
