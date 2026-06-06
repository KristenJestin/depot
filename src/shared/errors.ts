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

// ── Project repos ─────────────────────────────────────────────────────────────

export class RepoNotRegisteredError extends Data.TaggedError("RepoNotRegisteredError")<{
  projectId: string;
  repoRootPath: string;
  knownRepos: string[];
}> {
  get message() {
    const known =
      this.knownRepos.length > 0
        ? `Known repos: ${this.knownRepos.join(", ")}.`
        : "No repos registered for this project.";
    return (
      `Repo at '${this.repoRootPath}' is not registered for project '${this.projectId}'. ${known} ` +
      `Register it with \`depot project repo add\` (or the project settings page), ` +
      `or pass an explicit --repo/--sha.`
    );
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

// ── ADRs ──────────────────────────────────────────────────────────────────────

export class AdrNotFoundError extends Data.TaggedError("AdrNotFoundError")<{
  id: string;
}> {
  get message() {
    return `ADR not found: ${this.id}`;
  }
}

// ── Ideas (PRD 0027 / T1) ─────────────────────────────────────────────────────

export class IdeaNotFoundError extends Data.TaggedError("IdeaNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Idea not found: ${this.id}`;
  }
}

export class IdeaNotOpenError extends Data.TaggedError("IdeaNotOpenError")<{
  id: string;
  status: string;
}> {
  get message() {
    return `Idea ${this.id} is in status '${this.status}', not open. Only open ideas can be promoted.`;
  }
}

// ── PRD annexes ───────────────────────────────────────────────────────────────

export class AnnexNotFoundError extends Data.TaggedError("AnnexNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Annex not found: ${this.id}`;
  }
}

export class AnnexExistsError extends Data.TaggedError("AnnexExistsError")<{
  prdRevisionId: string;
  name: string;
}> {
  get message() {
    return `An annex named '${this.name}' already exists on revision ${this.prdRevisionId}. Pass --replace to overwrite it.`;
  }
}

// ── Prototypes (PRD 0025 / T1) ────────────────────────────────────────────────

export class PrototypeNotFoundError extends Data.TaggedError("PrototypeNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Prototype not found: ${this.id}`;
  }
}

export class PrototypeExistsError extends Data.TaggedError("PrototypeExistsError")<{
  prdRevisionId: string;
  slug: string;
}> {
  get message() {
    return `A prototype with slug '${this.slug}' already exists on revision ${this.prdRevisionId}.`;
  }
}

export class PrototypePageNotFoundError extends Data.TaggedError("PrototypePageNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Prototype page not found: ${this.id}`;
  }
}

export class PrototypePageExistsError extends Data.TaggedError("PrototypePageExistsError")<{
  prototypeId: string;
  slug: string;
}> {
  get message() {
    return `A page with slug '${this.slug}' already exists on prototype ${this.prototypeId}.`;
  }
}

export class PrototypePageNotFoundInPrototypeError extends Data.TaggedError(
  "PrototypePageNotFoundInPrototypeError",
)<{
  prototypeId: string;
  slug: string;
}> {
  get message() {
    return `Prototype ${this.prototypeId} has no page with slug '${this.slug}'.`;
  }
}

export class PrototypeVersionNotFoundError extends Data.TaggedError(
  "PrototypeVersionNotFoundError",
)<{
  id: string;
}> {
  get message() {
    return `Prototype page version not found: ${this.id}`;
  }
}

export class PrototypeVersionExistsError extends Data.TaggedError("PrototypeVersionExistsError")<{
  pageId: string;
  label: string;
}> {
  get message() {
    return `A version labelled '${this.label}' already exists on page ${this.pageId}.`;
  }
}

export class PrototypeVariantNotFoundError extends Data.TaggedError(
  "PrototypeVariantNotFoundError",
)<{
  id: string;
}> {
  get message() {
    return `Prototype variant not found: ${this.id}`;
  }
}

export class PrototypeVariantExistsError extends Data.TaggedError("PrototypeVariantExistsError")<{
  pageVersionId: string;
  label: string;
}> {
  get message() {
    return `A variant labelled '${this.label}' already exists on page version ${this.pageVersionId}.`;
  }
}

/**
 * Variant HTML references external resources the sandboxed prototype iframe
 * cannot load (`sandbox="allow-scripts"` with no `allow-same-origin`, plus a
 * `default-src 'none'` CSP). Such a variant would render blank, so `addVariant`
 * refuses it unless the caller explicitly passes `allowExternal`.
 */
export class PrototypeVariantExternalResourcesError extends Data.TaggedError(
  "PrototypeVariantExternalResourcesError",
)<{
  resources: { line: number; reason: string; snippet: string }[];
}> {
  get message() {
    const list = this.resources.map((r) => `  - ${r.reason} (line ${r.line})`).join("\n");
    return `HTML is not self-contained — it references external resources the sandboxed prototype iframe blocks, so the variant would render blank:\n${list}\nInline your CSS/JS (no CDN, no external src/href), or pass --allow-external to store it anyway.`;
  }
}

export class PrototypeRoundNotFoundError extends Data.TaggedError("PrototypeRoundNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Prototype round not found: ${this.id}`;
  }
}

export class PrototypeRoundLabelExistsError extends Data.TaggedError(
  "PrototypeRoundLabelExistsError",
)<{
  prototypeId: string;
  label: string;
}> {
  get message() {
    return `A round labelled '${this.label}' already exists on prototype ${this.prototypeId}.`;
  }
}

/**
 * Feedback submitted against a variant whose page version is no longer the
 * latest non-archived one for its page. Mapped to HTTP 409 by the web API: the
 * user must navigate to the latest version (the one the agent will actually
 * read on the next pass).
 */
export class FeedbackOnStaleVersionError extends Data.TaggedError("FeedbackOnStaleVersionError")<{
  variantId: string;
  pageId: string;
  staleVersionId: string;
  latestVersionId: string;
}> {
  get message() {
    return `Cannot create feedback against variant ${this.variantId}: its page version (${this.staleVersionId}) is no longer the latest non-archived version of page ${this.pageId} (latest is ${this.latestVersionId}). Navigate to the latest version to submit feedback the agent will read.`;
  }
}

export class FeedbackNotFoundError extends Data.TaggedError("FeedbackNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Feedback not found: ${this.id}`;
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
  /** Optional DB file path the operation was targeting, used by the CLI top-level formatter. */
  path?: string;
  /** Optional short label of the operation, e.g. `"open"`, `"query"`, `"migrate"`. */
  operation?: string;
}> {
  get message() {
    return `Database error: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}
