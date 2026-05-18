/**
 * workflow.ts — Async shim for backward compatibility.
 *
 * All functions here wrap the pure Effect domain functions with a raw Database
 * argument. This keeps the existing tests and any non-Effect callers (e.g.
 * agent-context.ts, workspace-bootstrap.ts) working without changes.
 *
 * The single call-site for Effect.runPromise lives in `runWithDb` below.
 * CLI commands that need the database directly should continue to use getDb()
 * from #/cli/runtime.
 */
import { Effect } from "effect";
import type { Database } from "#/db/client";
import type { TaskRow } from "#/db/schema";
import { Db } from "#/services/database";
import * as DomainProjects from "#/modules/projects/domain";
import * as DomainWorkspaces from "#/modules/workspaces/domain";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainActivity from "#/modules/activity/domain";
import * as DomainStatus from "#/modules/activity/status";
import * as DomainReviews from "#/modules/reviews/domain";
import type {
  ProjectStatus,
  Effort,
  EventType,
  ReviewType,
  SeverityLevel,
} from "#/shared/validator";

// ── Re-exports ────────────────────────────────────────────────────────────────

export type {
  WorkspaceRow,
  ProjectRow,
  PrdRow,
  PrdRevisionRow,
  ReviewRow,
  TaskRow,
  ActivityRow,
} from "#/db/schema";
export type { WorkspaceStatus } from "#/modules/activity/status";
export const RECENT_ACTIVITY_LIMIT = DomainStatus.RECENT_ACTIVITY_LIMIT;
export const findNextRecommendedTask = DomainStatus.findNextRecommendedTask;
export const summarizeActivityPayload = DomainActivity.summarizeActivityPayload;

// ── Shim helper ───────────────────────────────────────────────────────────────

function runWithDb<A>(db: Database, effect: Effect.Effect<A, any, Db>): Promise<A> {
  return Effect.runPromise(Effect.provideService(effect, Db, db));
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function createProject(db: Database, input: { name: string; description?: string }) {
  return runWithDb(db, DomainProjects.createProject(input));
}

export function listProjects(db: Database) {
  return runWithDb(db, DomainProjects.listProjects());
}

export function getProject(db: Database, id: string) {
  return runWithDb(db, DomainProjects.getProject(id));
}

export function updateProject(
  db: Database,
  id: string,
  changes: { name?: string; description?: string; status?: ProjectStatus },
) {
  return runWithDb(db, DomainProjects.updateProject(id, changes));
}

// ── Workspaces ────────────────────────────────────────────────────────────────

export function addWorkspace(
  db: Database,
  input: { projectId: string; path: string; label?: string },
) {
  return runWithDb(db, DomainWorkspaces.addWorkspace(input));
}

export function resolveWorkspace(db: Database, currentPath: string) {
  return runWithDb(db, DomainWorkspaces.resolveWorkspace(currentPath));
}

export function listWorkspaces(db: Database, filter: { projectId?: string } = {}) {
  return runWithDb(db, DomainWorkspaces.listWorkspaces(filter));
}

export function getWorkspace(db: Database, id: string) {
  return runWithDb(db, DomainWorkspaces.getWorkspace(id));
}

export function updateWorkspaceLabel(db: Database, id: string, label: string | null) {
  return runWithDb(db, DomainWorkspaces.updateWorkspaceLabel(id, label));
}

export function removeWorkspace(db: Database, id: string, force = false) {
  return runWithDb(db, DomainWorkspaces.removeWorkspace(id, force));
}

// ── PRDs ──────────────────────────────────────────────────────────────────────

export function createPrd(
  db: Database,
  input: { projectId: string; title: string; context?: string; scope?: string },
) {
  return runWithDb(db, DomainPrds.createPrd(input));
}

export function getPrd(db: Database, id: string) {
  return runWithDb(db, DomainPrds.getPrd(id));
}

export function listPrds(
  db: Database,
  filter: { projectId?: string; workspaceId?: string; latestOnly?: boolean } = {},
) {
  return runWithDb(db, DomainPrds.listPrds(filter));
}

export function activatePrd(db: Database, id: string, workspaceId: string) {
  return runWithDb(db, DomainPrds.activatePrd(id, workspaceId));
}

export function markPrdReady(db: Database, id: string) {
  return runWithDb(db, DomainPrds.markPrdReady(id));
}

export function updatePrd(
  db: Database,
  id: string,
  changes: { title?: string; context?: string | null; scope?: string | null },
) {
  return runWithDb(db, DomainPrds.updatePrd(id, changes));
}

export function donePrd(db: Database, id: string) {
  return runWithDb(db, DomainPrds.donePrd(id));
}

export function cancelPrd(db: Database, id: string) {
  return runWithDb(db, DomainPrds.cancelPrd(id));
}

export function requestReviewPrd(db: Database, id: string, reason?: string) {
  return runWithDb(db, DomainPrds.requestReviewPrd(id, reason));
}

export function resumePrd(db: Database, id: string) {
  return runWithDb(db, DomainPrds.resumePrd(id));
}

export function forkPrd(db: Database, id: string) {
  return runWithDb(db, DomainPrds.forkPrd(id));
}

export function listPrdFamily(db: Database, prdId: string) {
  return runWithDb(db, DomainPrds.listPrdFamily(prdId));
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export function createTask(
  db: Database,
  input: {
    prdRevisionId: string;
    title: string;
    description: string;
    doneCriteria: string;
    effort: Effort;
    dependsOn?: string[];
    phaseNumber?: number;
  },
) {
  return runWithDb(db, DomainTasks.createTask(input));
}

export function updateTask(
  db: Database,
  id: string,
  changes: {
    title?: string;
    description?: string;
    doneCriteria?: string;
    effort?: Effort;
    phaseNumber?: number | null;
    dependsOn?: string[];
    addDependsOn?: string[];
    removeDependsOn?: string[];
    severity?: SeverityLevel | null;
  },
) {
  return runWithDb(db, DomainTasks.updateTask(id, changes));
}

export function getTask(db: Database, id: string) {
  return runWithDb(db, DomainTasks.getTask(id));
}

export function listTasks(db: Database, prdRevisionId: string) {
  return runWithDb(db, DomainTasks.listTasks(prdRevisionId));
}

export function startTask(db: Database, id: string) {
  return runWithDb(db, DomainTasks.startTask(id));
}

export function completeTask(db: Database, id: string) {
  return runWithDb(db, DomainTasks.completeTask(id));
}

export function blockTask(db: Database, id: string, reason: string) {
  return runWithDb(db, DomainTasks.blockTask(id, reason));
}

export function skipTask(db: Database, id: string, reason: string) {
  return runWithDb(db, DomainTasks.skipTask(id, reason));
}

// ── Activity Log ──────────────────────────────────────────────────────────────

export function logActivity(
  db: Database,
  input: {
    projectId: string;
    workspaceId?: string;
    prdRevisionId?: string;
    taskId?: string;
    eventType: EventType;
    payload: Record<string, unknown>;
  },
) {
  return runWithDb(db, DomainActivity.logActivity(input));
}

export function listActivity(
  db: Database,
  filter: { projectId: string; workspaceId?: string; limit?: number },
) {
  return runWithDb(db, DomainActivity.listActivity(filter));
}

export function listActivityForRevision(db: Database, prdRevisionId: string) {
  return runWithDb(db, DomainActivity.listActivityForRevision(prdRevisionId));
}

// ── Workspace status ──────────────────────────────────────────────────────────

export function buildWorkspaceStatus(db: Database, workspaceId: string) {
  return runWithDb(db, DomainStatus.buildWorkspaceStatus(workspaceId));
}

// ── Reviews ───────────────────────────────────────────────────────────────────

export function createReview(db: Database, input: { prdRevisionId: string; type: ReviewType }) {
  return runWithDb(db, DomainReviews.createReview(input));
}

export function getReview(db: Database, id: string) {
  return runWithDb(db, DomainReviews.getReview(id));
}

export function listReviews(db: Database, prdRevisionId: string) {
  return runWithDb(db, DomainReviews.listReviews(prdRevisionId));
}

export function startReview(db: Database, id: string) {
  return runWithDb(db, DomainReviews.startReview(id));
}

export function updateReview(db: Database, id: string, changes: { userFeedback?: string | null }) {
  return runWithDb(db, DomainReviews.updateReview(id, changes));
}

export function doneReview(db: Database, id: string) {
  return runWithDb(db, DomainReviews.doneReview(id));
}

export function addReviewTask(
  db: Database,
  reviewId: string,
  input: {
    title: string;
    description: string;
    doneCriteria: string;
    severity?: SeverityLevel;
    effort?: Effort;
  },
) {
  return runWithDb(db, DomainReviews.addReviewTask(reviewId, input));
}

export function listReviewTasks(db: Database, reviewId: string) {
  return runWithDb(db, DomainReviews.listReviewTasks(reviewId));
}

// ── Batch operations ──────────────────────────────────────────────────────────

export function loadPrd(
  db: Database,
  input: {
    projectId: string;
    title: string;
    context?: string;
    scope?: string;
    ready: boolean;
    tasks: Array<{
      title: string;
      description: string;
      doneCriteria: string;
      effort: Effort;
      dependsOn: number[];
      phaseNumber?: number;
    }>;
  },
): Promise<{ prd: Awaited<ReturnType<typeof createPrd>>; tasks: TaskRow[] }> {
  return runWithDb(db, DomainPrds.loadPrdBatch(input));
}

export function reloadPrd(
  db: Database,
  input: {
    prdRevisionId: string;
    title: string;
    context?: string;
    scope?: string;
    tasks: Array<{
      title: string;
      description: string;
      doneCriteria: string;
      effort: Effort;
      dependsOn?: number[];
    }>;
  },
): Promise<{ prd: Awaited<ReturnType<typeof createPrd>>; tasks: TaskRow[] }> {
  return runWithDb(db, DomainPrds.reloadPrdBatch(input));
}

export function phaseAdvance(db: Database, id: string) {
  return runWithDb(db, DomainPrds.phaseAdvance(id));
}
