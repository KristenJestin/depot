import { Data } from "effect";

// ── Projects ──────────────────────────────────────────────────────────────────

export class ProjectNotFoundError extends Data.TaggedError("ProjectNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Project not found: ${this.id}`;
  }
}

// ── Workspaces ────────────────────────────────────────────────────────────────

export class WorkspaceNotFoundError extends Data.TaggedError("WorkspaceNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Workspace not found: ${this.id}`;
  }
}

export class WorkspaceHasLinkedPrdsError extends Data.TaggedError("WorkspaceHasLinkedPrdsError")<{
  workspaceId: string;
  count: number;
}> {
  get message() {
    return `Workspace has ${this.count} linked PRD(s). Use --force to remove anyway.`;
  }
}

// ── PRDs ──────────────────────────────────────────────────────────────────────

export class PrdNotFoundError extends Data.TaggedError("PrdNotFoundError")<{
  id: string;
}> {
  get message() {
    return `PRD not found: ${this.id}`;
  }
}

export class PrdNotDraftError extends Data.TaggedError("PrdNotDraftError")<{
  id: string;
  status: string;
}> {
  get message() {
    const hint =
      this.status === "ready"
        ? " Run `depot prd fork <prd-id>` to create a new draft revision, then modify that."
        : " No modifications are allowed on a PRD in this status.";
    return `PRD ${this.id} is in status '${this.status}'. Only draft PRDs can be modified.${hint}`;
  }
}

export class WorkspaceAlreadyHasActivePrdError extends Data.TaggedError(
  "WorkspaceAlreadyHasActivePrdError",
)<{
  workspaceId: string;
  activePrdId: string;
}> {
  get message() {
    return `Cannot activate PRD: workspace already has active PRD '${this.activePrdId}'`;
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Task not found: ${this.id}`;
  }
}

export class DependencyNotDoneError extends Data.TaggedError("DependencyNotDoneError")<{
  taskId: string;
  depId: string;
  depStatus: string;
}> {
  get message() {
    return `Cannot complete task: dependency '${this.depId}' is not done (status: '${this.depStatus}')`;
  }
}

// ── Shared ────────────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Data.TaggedError("InvalidTransitionError")<{
  entity: string;
  from: string;
  to: string;
  allowed: string[];
}> {
  get message() {
    return `Invalid ${this.entity} transition: '${this.from}' -> '${this.to}'. Allowed: ${this.allowed.join(", ") || "none"}`;
  }
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  reason: string;
}> {
  get message() {
    return this.reason;
  }
}

export class CrossEntityError extends Data.TaggedError("CrossEntityError")<{
  reason: string;
}> {
  get message() {
    return this.reason;
  }
}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  cause: unknown;
}> {
  get message() {
    return `Database error: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}
