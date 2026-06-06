/**
 * Seed script for local UI development.
 *
 * Usage: bun run seed
 *
 * The script resets the configured dev database and fills it with a compact
 * showcase dataset for the web UI.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import * as schema from "#/db/schema";
import { generateId } from "#/shared/utils";

const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
const dbPath = process.env["DB_PATH"] ?? `${home.replace(/\\/g, "/")}/.depot/depot.db`;
const migrationsFolder = path.resolve(import.meta.dirname, "../src/db/migrations");
const repoRoot = process.cwd();
const textDecoder = new TextDecoder();

if (existsSync(dbPath)) {
  try {
    unlinkSync(dbPath);
    console.log(`Dropped old database at: ${dbPath}`);
  } catch (err: unknown) {
    const isLocked =
      err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EBUSY";
    if (!isLocked) throw err;

    console.log("Database is locked; dropping all tables in-place...");
    const tmp = new Database(dbPath);
    tmp.exec("PRAGMA foreign_keys = OFF;");
    const tables = tmp
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
      )
      .all();
    for (const { name } of tables) {
      tmp.exec(`DROP TABLE IF EXISTS "${name}";`);
    }
    tmp.exec("PRAGMA foreign_keys = ON;");
    tmp.close();
    console.log("All tables dropped.");
  }
}

mkdirSync(path.dirname(dbPath), { recursive: true });
console.log(`Creating fresh database at: ${dbPath}`);

const client = new Database(dbPath);
client.exec("PRAGMA journal_mode = WAL;");
client.exec("PRAGMA foreign_keys = ON;");

const db = drizzle({ client, relations: schema.relations, casing: "snake_case" });

migrate(db, { migrationsFolder });
console.log("Migrations applied.");

function id() {
  return generateId();
}

function ago(days: number, hours = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function gitRev(ref: string): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", ref], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!result.success) return null;
  const sha = textDecoder.decode(result.stdout).trim();
  return sha.length > 0 ? sha : null;
}

function terminalPayload(lines: Array<{ text: string; type: "command" | "output" }>): string {
  return json({ kind: "terminal", lines });
}

function donePayload(files: Array<{ path: string; added: number; removed: number }>): string {
  return json({ files });
}

const head = gitRev("HEAD") ?? "0000000000000000000000000000000000000000";
const base = gitRev("HEAD~1") ?? head;
const previous = gitRev("HEAD~2") ?? base;

const projectDepot = id();
const projectLibrary = id();
const projectArchive = id();

const workspaceDepot = id();
const workspaceLibrary = id();
const workspaceArchive = id();

const prdShowcase = id();
const prdShowcaseRev = id();
const prdReady = id();
const prdReadyRev = id();
const prdReview = id();
const prdReviewRev = id();
const prdDone = id();
const prdDoneRev1 = id();
const prdDoneRev2 = id();
const prdDraft = id();
const prdDraftRev = id();

const reviewHuman = id();
const reviewAgent = id();

const taskDiffAnimation = id();
const taskCossSelect = id();
const taskCommitSuggestion = id();
const taskDirectiveValidation = id();
const taskDocsSync = id();
const taskKeyboardAudit = id();
const taskReadySpec = id();
const taskReviewFix = id();
const taskDoneCapture = id();

const storyReview = id();
const storyForms = id();
const storyDocs = id();

const now = new Date();

await db.insert(schema.projects).values([
  {
    id: projectDepot,
    name: "Depot CLI",
    description: "Local-first AI agent task and PRD management tool.",
    status: "active",
    createdAt: ago(45),
    updatedAt: now,
  },
  {
    id: projectLibrary,
    name: "Design System Lab",
    description: "Small companion project used to preview component states.",
    status: "paused",
    createdAt: ago(28),
    updatedAt: ago(2),
  },
  {
    id: projectArchive,
    name: "Legacy Import",
    description: "Completed migration archive kept around for historical views.",
    status: "done",
    createdAt: ago(90),
    updatedAt: ago(30),
  },
]);

await db.insert(schema.workspaces).values([
  {
    id: workspaceDepot,
    projectId: projectDepot,
    path: repoRoot,
    label: "current repo",
    createdAt: ago(45),
    updatedAt: now,
  },
  {
    id: workspaceLibrary,
    projectId: projectLibrary,
    path: path.join(repoRoot, ".depot-dev", "design-system-lab"),
    label: "component sandbox",
    createdAt: ago(28),
    updatedAt: ago(2),
  },
  {
    id: workspaceArchive,
    projectId: projectArchive,
    path: path.join(repoRoot, ".depot-dev", "legacy-import"),
    label: "archive",
    createdAt: ago(90),
    updatedAt: ago(30),
  },
]);

await db.insert(schema.prds).values([
  {
    id: prdShowcase,
    projectId: projectDepot,
    currentRevisionId: prdShowcaseRev,
    createdAt: ago(8),
    updatedAt: now,
  },
  {
    id: prdReady,
    projectId: projectDepot,
    currentRevisionId: prdReadyRev,
    createdAt: ago(4),
    updatedAt: ago(1),
  },
  {
    id: prdReview,
    projectId: projectDepot,
    currentRevisionId: prdReviewRev,
    createdAt: ago(6),
    updatedAt: ago(1, 2),
  },
  {
    id: prdDone,
    projectId: projectDepot,
    currentRevisionId: prdDoneRev2,
    createdAt: ago(24),
    updatedAt: ago(5),
  },
  {
    id: prdDraft,
    projectId: projectLibrary,
    currentRevisionId: prdDraftRev,
    createdAt: ago(2),
    updatedAt: ago(1),
  },
]);

await db.insert(schema.prdRevisions).values([
  {
    id: prdShowcaseRev,
    prdId: prdShowcase,
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    revision: 1,
    title: "Review diff and project settings polish",
    context:
      "The review screen needs smoother panels, better comment targeting, and project forms that match the Coss UI components.",
    scope:
      "Includes diff panel animations, multi-line review comments, Coss selects, directive settings, pending actions, docs metadata, and commit message suggestions.",
    problem:
      "Reviewers lose context when panels snap open and cannot express findings that span several changed lines.",
    solution:
      "Keep files/context panels mounted while animating width and opacity, and persist richer PRD metadata for the review and commit UI.",
    implementationDecisions:
      "Use Base UI powered Coss-style selects, shared input/textarea tokens, phase snapshots for per-phase review context, and PRD-level suggested commit messages.",
    testingDecisions:
      "Exercise the seeded PRD through the dashboard, review diff page, project settings page, docs page, and pending action drawer.",
    status: "in_progress",
    auditCycles: 1,
    currentPhase: 2,
    suggestedCommitMessage: "feat(web): polish review diff and project controls",
    createdAt: ago(8),
    updatedAt: now,
    readyAt: ago(7),
    activatedAt: ago(6),
  },
  {
    id: prdReadyRev,
    prdId: prdReady,
    projectId: projectDepot,
    workspaceId: null,
    revision: 1,
    title: "CLI install target resolver",
    context: "Install commands should resolve shell integration targets deterministically.",
    scope: "Includes Windows and POSIX target detection. Excludes package manager installers.",
    problem: "The install flow currently gives agents too much room to guess shell paths.",
    solution: "Centralize target resolution and show all writes before applying them.",
    implementationDecisions: "Keep filesystem writes behind explicit target descriptors.",
    testingDecisions: "Unit-test Windows, PowerShell, Bash, and unsupported-shell branches.",
    status: "ready",
    auditCycles: 0,
    currentPhase: null,
    suggestedCommitMessage: "feat(cli): resolve install targets consistently",
    createdAt: ago(4),
    updatedAt: ago(1),
    readyAt: ago(1),
  },
  {
    id: prdReviewRev,
    prdId: prdReview,
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    revision: 1,
    title: "Docs sync command review gate",
    context: "Documentation updates should be reviewable before the agent marks a PRD done.",
    scope: "Includes pending doc sync actions and docs profile reporting.",
    problem: "Docs drift is hard to spot when implementation and docs changes land separately.",
    solution: "Queue an explicit doc sync action and expose generated artifacts in the web UI.",
    implementationDecisions:
      "Keep pending actions project-scoped and link them back to the source PRD revision.",
    testingDecisions: "Seed pending and consumed actions so both list states can be checked.",
    status: "review",
    auditCycles: 2,
    currentPhase: null,
    suggestedCommitMessage: "feat(docs): add reviewable doc sync handoff",
    createdAt: ago(6),
    updatedAt: ago(1, 2),
    readyAt: ago(5),
    activatedAt: ago(4),
  },
  {
    id: prdDoneRev1,
    prdId: prdDone,
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    revision: 1,
    title: "Activity timeline cleanup",
    context: "The original activity timeline needed clearer event payloads.",
    scope: "Includes terminal notes and task done summaries.",
    status: "done",
    auditCycles: 1,
    createdAt: ago(24),
    updatedAt: ago(16),
    readyAt: ago(23),
    activatedAt: ago(22),
    supersededAt: ago(15),
  },
  {
    id: prdDoneRev2,
    prdId: prdDone,
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    revision: 2,
    title: "Activity timeline cleanup",
    context: "The timeline should distinguish human and AI events.",
    scope: "Includes activity source labels and revision-scoped history.",
    problem: "Reviewing a finished PRD is harder when all events look agent-generated.",
    solution: "Persist event source and show revision history next to the active PRD.",
    implementationDecisions: "Attach activity to PRD revisions and keep the logical PRD stable.",
    testingDecisions: "Seed both revision rows so the revision switcher has something to show.",
    status: "done",
    auditCycles: 2,
    suggestedCommitMessage: "feat(web): show activity event sources",
    createdAt: ago(15),
    updatedAt: ago(5),
    readyAt: ago(14),
    activatedAt: ago(13),
  },
  {
    id: prdDraftRev,
    prdId: prdDraft,
    projectId: projectLibrary,
    workspaceId: workspaceLibrary,
    revision: 1,
    title: "Component token audit",
    context: "The component sandbox tracks visual consistency issues before they land in depot.",
    scope: "Includes input, select, textarea, badge, and card tokens.",
    problem: "Form fields can drift when local components are wrapped differently.",
    solution: "Document expected token usage and preview each state in one project.",
    implementationDecisions: "Keep the draft unready so the dashboard shows an untouched PRD.",
    testingDecisions: "Manual UI review only for this seeded draft.",
    status: "draft",
    auditCycles: 0,
    currentPhase: null,
    createdAt: ago(2),
    updatedAt: ago(1),
  },
]);

await db.insert(schema.userStories).values([
  {
    id: storyReview,
    prdRevisionId: prdShowcaseRev,
    position: 1,
    asRole: "as a reviewer",
    want: "I want to comment on a range of changed lines",
    so: "so that feedback can describe one coherent issue instead of many tiny comments",
    notes: "Use the review diff page and drag across added lines.",
    createdAt: ago(7),
    updatedAt: now,
  },
  {
    id: storyForms,
    prdRevisionId: prdShowcaseRev,
    position: 2,
    asRole: "as a project owner",
    want: "I want settings forms to share the same visual language",
    so: "so that inputs, selects, and textareas feel like one design system",
    notes: "Settings > Directives exercises select, input, textarea, buttons, and validation.",
    createdAt: ago(7),
    updatedAt: now,
  },
  {
    id: storyDocs,
    prdRevisionId: prdReviewRev,
    position: 1,
    asRole: "as a maintainer",
    want: "I want docs sync output linked to the PRD that caused it",
    so: "so that release review can include docs without guessing provenance",
    createdAt: ago(5),
    updatedAt: ago(1),
  },
]);

await db.insert(schema.tasks).values([
  {
    id: taskDiffAnimation,
    prdRevisionId: prdShowcaseRev,
    position: 1,
    title: "Animate files and context panels",
    description:
      "Keep both panels mounted and animate width, opacity, and border while preserving diff layout.",
    descriptionFormat: "plain",
    doneCriteria: "Opening and closing either panel is smooth on desktop and narrow widths.",
    dependsOn: "[]",
    effort: "s",
    kind: "slice",
    phaseNumber: 1,
    status: "done",
    triageState: "ready-for-agent",
    startedAt: ago(6),
    completedAt: ago(5, 18),
    createdAt: ago(7),
  },
  {
    id: taskCossSelect,
    prdRevisionId: prdShowcaseRev,
    position: 2,
    title: "Replace native selects in project settings",
    description:
      "Use the local Coss-style Select wrapper with alignItemWithTrigger disabled by default.",
    descriptionFormat: "plain",
    doneCriteria: "Directive scope/kind controls render with the same surface color as inputs.",
    dependsOn: json([taskDiffAnimation]),
    effort: "m",
    kind: "slice",
    phaseNumber: 2,
    status: "in_progress",
    triageState: "ready-for-agent",
    startedAt: ago(1, 4),
    createdAt: ago(7),
  },
  {
    id: taskCommitSuggestion,
    prdRevisionId: prdShowcaseRev,
    position: 3,
    title: "Expose suggested commit message",
    description:
      "Show the PRD or phase suggestion near the commit form and let the user copy it into the editable textarea.",
    descriptionFormat: "plain",
    doneCriteria: "The suggestion is visible, optional, and editable before committing.",
    dependsOn: json([taskCossSelect]),
    effort: "s",
    kind: "support",
    phaseNumber: 2,
    status: "pending",
    triageState: "ready-for-human",
    createdAt: ago(7),
  },
  {
    id: taskDirectiveValidation,
    prdRevisionId: prdShowcaseRev,
    position: 4,
    title: "Review directive validation states",
    description:
      "Check that focus, invalid, placeholder, and textarea states follow the shared form tokens.",
    descriptionFormat: "plain",
    doneCriteria: "Validation does not show destructive styling before there is an error.",
    dependsOn: json([taskCossSelect]),
    effort: "s",
    kind: "gate",
    phaseNumber: 2,
    status: "blocked",
    triageState: "needs-info",
    blockedReason: "Waiting for visual review on Windows.",
    createdAt: ago(7),
  },
  {
    id: taskDocsSync,
    prdRevisionId: prdShowcaseRev,
    position: 5,
    title: "Queue docs sync action",
    description: "Create a pending action that points the user to the docs sync handoff.",
    descriptionFormat: "plain",
    doneCriteria: "Pending actions show a doc sync command linked to this PRD.",
    dependsOn: json([taskCommitSuggestion]),
    effort: "xs",
    kind: "support",
    phaseNumber: 3,
    status: "pending",
    triageState: "ready-for-agent",
    createdAt: ago(7),
  },
  {
    id: taskKeyboardAudit,
    prdRevisionId: prdShowcaseRev,
    position: 6,
    title: "Keyboard audit for the review diff",
    description: "Deferred until the diff interactions settle.",
    descriptionFormat: "plain",
    doneCriteria: "Tab order and Escape behavior are reviewed.",
    dependsOn: "[]",
    effort: "xs",
    kind: "gate",
    phaseNumber: 3,
    status: "skipped",
    triageState: "wontfix",
    skipReason: "Out of this PRD; captured as a follow-up.",
    createdAt: ago(7),
  },
  {
    id: taskReadySpec,
    prdRevisionId: prdReadyRev,
    position: 1,
    title: "Specify install target discovery",
    description: "Document shell target discovery and dry-run output shape.",
    descriptionFormat: "plain",
    doneCriteria: "Ready PRD has at least one task for dashboard preview.",
    dependsOn: "[]",
    effort: "m",
    kind: "slice",
    status: "pending",
    createdAt: ago(4),
  },
  {
    id: taskReviewFix,
    prdRevisionId: prdReviewRev,
    position: 1,
    title: "Resolve docs profile naming feedback",
    description: "Adjust the default docs profile copy before approval.",
    descriptionFormat: "plain",
    doneCriteria: "Reviewer feedback is closed or converted to an out-of-scope item.",
    dependsOn: "[]",
    effort: "s",
    kind: "support",
    status: "in_progress",
    createdAt: ago(6),
  },
  {
    id: taskDoneCapture,
    prdRevisionId: prdDoneRev2,
    position: 1,
    title: "Capture event source in activity timeline",
    description: "Persist and show whether each timeline event came from a human or an agent.",
    descriptionFormat: "plain",
    doneCriteria: "Finished PRD view shows a complete done task and mixed activity sources.",
    dependsOn: "[]",
    effort: "m",
    kind: "slice",
    status: "done",
    completedAt: ago(6),
    createdAt: ago(15),
  },
]);

await db.insert(schema.taskUserStories).values([
  { taskId: taskDiffAnimation, userStoryId: storyReview },
  { taskId: taskCossSelect, userStoryId: storyForms },
  { taskId: taskCommitSuggestion, userStoryId: storyReview },
  { taskId: taskDocsSync, userStoryId: storyDocs },
]);

await db.insert(schema.reviews).values([
  {
    id: reviewHuman,
    prdRevisionId: prdShowcaseRev,
    type: "human",
    status: "in_progress",
    userFeedback: "Check the select popup, placeholder parity, and commit suggestion handoff.",
    phaseNumber: 2,
    createdAt: ago(1, 3),
    updatedAt: ago(0, 8),
  },
  {
    id: reviewAgent,
    prdRevisionId: prdShowcaseRev,
    type: "agent",
    status: "done",
    userFeedback: null,
    phaseNumber: 1,
    createdAt: ago(5, 12),
    updatedAt: ago(5, 10),
    doneAt: ago(5, 10),
  },
]);

await db.insert(schema.tasks).values([
  {
    id: id(),
    prdRevisionId: prdShowcaseRev,
    position: 1,
    title: "src/web/components/ui/select.tsx:38-52",
    description:
      "The selected item indicator must not consume label width when option labels are long.",
    descriptionFormat: "plain",
    doneCriteria: "Long select options remain readable and the checkmark stays aligned.",
    dependsOn: "[]",
    effort: "s",
    kind: "support",
    status: "pending",
    reviewId: reviewHuman,
    severity: "major",
    axis: "human",
    triageState: "needs-triage",
    linkedFilePath: "src/web/components/ui/select.tsx",
    linkedStartLine: 38,
    linkedEndLine: 52,
    linkedDiffSha: head,
    createdAt: ago(0, 8),
  },
  {
    id: id(),
    prdRevisionId: prdShowcaseRev,
    position: 2,
    title: "src/web/components/commit-form.tsx:22-44",
    description:
      "The suggestion should be visible without silently replacing the user's current commit message.",
    descriptionFormat: "plain",
    doneCriteria: "User can apply the suggestion, edit it, or ignore it.",
    dependsOn: "[]",
    effort: "xs",
    kind: "support",
    status: "pending",
    reviewId: reviewHuman,
    severity: "minor",
    axis: "human",
    triageState: "ready-for-human",
    linkedFilePath: "src/web/components/commit-form.tsx",
    linkedStartLine: 22,
    linkedEndLine: 44,
    linkedDiffSha: head,
    createdAt: ago(0, 8),
  },
  {
    id: id(),
    prdRevisionId: prdShowcaseRev,
    position: 1,
    title: "Review diff context loads phase brief",
    description: "Phase context should include current tasks and out-of-scope decisions.",
    descriptionFormat: "plain",
    doneCriteria: "Context panel displays the phase brief and deferred items.",
    dependsOn: "[]",
    effort: "xs",
    kind: "gate",
    status: "done",
    reviewId: reviewAgent,
    severity: "info",
    axis: "spec",
    triageState: "ready-for-agent",
    createdAt: ago(5, 11),
    completedAt: ago(5, 10),
  },
]);

await db.insert(schema.outOfScopeItems).values([
  {
    id: id(),
    projectId: projectDepot,
    prdRevisionId: prdShowcaseRev,
    title: "Diff comment persistence across browser refresh",
    reason:
      "The current PRD covers creating review tasks from annotations, not local draft recovery.",
    decidedAt: ago(1, 4),
    decidedBy: "human",
    createdAt: ago(1, 4),
    updatedAt: ago(1, 4),
  },
  {
    id: id(),
    projectId: projectDepot,
    prdRevisionId: null,
    title: "Standalone binary distribution",
    reason: "Depot targets npm global installs with Node 25 instead of bundled binaries.",
    decidedAt: ago(10),
    decidedBy: "ai",
    createdAt: ago(10),
    updatedAt: ago(10),
  },
]);

const docsProfile = id();

await db.insert(schema.docArtifacts).values([
  {
    id: id(),
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    kind: "context",
    path: "docs/concepts/review-workflow.md",
    number: null,
    title: "Review workflow context",
    status: null,
    linkedPrdRevisionId: prdShowcaseRev,
    lastModifiedAt: ago(0, 5),
    lastModifiedBySource: "ai",
    createdAt: ago(0, 5),
    updatedAt: ago(0, 5),
  },
  {
    id: id(),
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    kind: "adr",
    path: "docs/adr/0004-prd-phase-snapshots.md",
    number: 4,
    title: "Store PRD phase snapshots",
    status: "accepted",
    linkedPrdRevisionId: prdShowcaseRev,
    lastModifiedAt: ago(1),
    lastModifiedBySource: "human",
    createdAt: ago(1),
    updatedAt: ago(1),
  },
  {
    id: id(),
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    kind: "glossary",
    path: "docs/glossary.md",
    number: null,
    title: "Depot glossary",
    status: null,
    linkedPrdRevisionId: null,
    lastModifiedAt: ago(2),
    lastModifiedBySource: "ai",
    createdAt: ago(2),
    updatedAt: ago(2),
  },
  {
    id: id(),
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    kind: "freeform",
    path: "docs/manual-qa/review-diff.md",
    number: null,
    title: "Manual QA notes for review diff",
    status: null,
    linkedPrdRevisionId: prdShowcaseRev,
    lastModifiedAt: ago(0, 3),
    lastModifiedBySource: "human",
    createdAt: ago(0, 3),
    updatedAt: ago(0, 3),
  },
]);

await db.insert(schema.docProfiles).values([
  {
    id: docsProfile,
    projectId: projectDepot,
    name: "product-docs",
    targetRoot: "docs",
    targetPattern: "**/*.md",
    sources: json(["docs/index.md", "docs/concepts/index.md", ".scratch/**/PRD.md"]),
    language: "fr",
    style: "mixed",
    audience: "maintainers and agent operators",
    routingRules: json([
      { kind: "adr", path: "docs/adr" },
      { kind: "context", path: "docs/concepts" },
    ]),
    topicsToCover: json(["review workflow", "project settings", "docs sync"]),
    topicsToIgnore: json(["npm publishing"]),
    guardrails: json(["Do not rewrite unrelated docs", "Keep ADR numbers stable"]),
    commitPolicy: "suggest-only",
    createdAt: ago(4),
    updatedAt: ago(0, 5),
  },
]);

await db.insert(schema.docSyncRuns).values([
  {
    id: id(),
    profileId: docsProfile,
    triggeredByPrdId: prdShowcaseRev,
    sinceRef: base,
    untilRef: head,
    ranAt: ago(0, 4),
    summary: "Updated review workflow context and ADR index candidates.",
    filesChanged: json([
      "docs/concepts/review-workflow.md",
      "docs/adr/0004-prd-phase-snapshots.md",
    ]),
  },
  {
    id: id(),
    profileId: docsProfile,
    triggeredByPrdId: prdReviewRev,
    sinceRef: previous,
    untilRef: base,
    ranAt: ago(2),
    summary: "Prepared docs sync handoff for human review.",
    filesChanged: json(["docs/index.md"]),
  },
]);

await db.insert(schema.projectConfig).values([
  {
    projectId: projectDepot,
    key: "baseBranch",
    value: "master",
    updatedAt: ago(1),
    updatedBySource: "human",
  },
  {
    projectId: projectDepot,
    key: "defaultDocProfile",
    value: "product-docs",
    updatedAt: ago(1),
    updatedBySource: "ai",
  },
  {
    projectId: projectDepot,
    key: "protectedFiles",
    value: ".env,secrets,private",
    updatedAt: ago(2),
    updatedBySource: "human",
  },
  {
    projectId: projectDepot,
    key: "pendingActionTtlDays",
    value: "10",
    updatedAt: ago(3),
    updatedBySource: "ai",
  },
]);

await db.insert(schema.pendingActions).values([
  {
    id: id(),
    projectId: projectDepot,
    kind: "advance-phase",
    payload: json({ prdRevisionId: prdShowcaseRev, nextPhase: 3 }),
    status: "pending",
    sourcePrdId: prdShowcaseRev,
    slashCommand: "/depot-advance-phase review-diff-and-project-settings-polish",
    humanReadableLabel: "Advance PRD to phase 3 after UI review",
    createdAt: ago(0, 5),
  },
  {
    id: id(),
    projectId: projectDepot,
    kind: "run-doc-sync",
    payload: json({ profile: "product-docs", prdRevisionId: prdReviewRev }),
    status: "pending",
    sourcePrdId: prdReviewRev,
    slashCommand: "/depot-doc product-docs",
    humanReadableLabel: "Run product docs sync for the review gate",
    createdAt: ago(1),
  },
  {
    id: id(),
    projectId: projectDepot,
    kind: "submit-review",
    payload: json({ reviewId: reviewAgent }),
    status: "consumed",
    sourcePrdId: prdShowcaseRev,
    slashCommand: "/depot-review-submit",
    humanReadableLabel: "Submit completed agent review",
    createdAt: ago(5, 9),
    consumedAt: ago(5, 8),
    consumedBySource: "ai",
  },
]);

await db.insert(schema.projectDirectives).values([
  {
    id: id(),
    projectId: projectDepot,
    scope: "always",
    title: "Format before handoff",
    instruction: "bun run fmt",
    kind: "command",
    blocking: true,
    position: 1,
    enabled: true,
    lastRunAt: ago(0, 2),
    lastRunStatus: "ok",
    lastRunOutput: "Formatted 12 files.",
    createdAt: ago(3),
    updatedAt: ago(0, 2),
  },
  {
    id: id(),
    projectId: projectDepot,
    scope: "pre-review",
    title: "Run focused checks",
    instruction: "bun run check",
    kind: "command",
    blocking: true,
    position: 2,
    enabled: true,
    lastRunAt: ago(0, 1),
    lastRunStatus: "fail",
    lastRunOutput: "typecheck failed before select item layout was fixed.",
    createdAt: ago(3),
    updatedAt: ago(0, 1),
  },
  {
    id: id(),
    projectId: projectDepot,
    scope: "pre-commit",
    title: "Suggested commit stays editable",
    instruction:
      "When a suggestedCommitMessage exists, show it as an optional insert action rather than auto-submitting it.",
    kind: "rule",
    blocking: true,
    position: 3,
    enabled: true,
    createdAt: ago(2),
    updatedAt: ago(2),
  },
  {
    id: id(),
    projectId: projectDepot,
    scope: "on-error",
    title: "Capture failing command output",
    instruction: "Always add the failing command, stderr summary, and the next concrete action.",
    kind: "rule",
    blocking: false,
    position: 4,
    enabled: false,
    createdAt: ago(2),
    updatedAt: ago(1),
  },
]);

await db.insert(schema.activityLog).values([
  {
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    prdRevisionId: prdShowcaseRev,
    eventType: "session_start",
    payload: json({ message: "Seeded showcase session started." }),
    source: "human",
    createdAt: ago(7),
  },
  {
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    prdRevisionId: prdShowcaseRev,
    taskId: taskDiffAnimation,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ bun run typecheck", type: "command" },
      { text: "Found 0 errors.", type: "output" },
      { text: "$ bun run test tests/web/prd-view-model.test.ts", type: "command" },
      { text: "4 passed", type: "output" },
    ]),
    source: "ai",
    createdAt: ago(5, 20),
  },
  {
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    prdRevisionId: prdShowcaseRev,
    taskId: taskDiffAnimation,
    eventType: "task_done",
    payload: donePayload([
      { path: "src/web/routes/prds.$id.review-diff.tsx", added: 74, removed: 18 },
      { path: "src/web/components/diff-viewer.tsx", added: 52, removed: 9 },
    ]),
    source: "ai",
    createdAt: ago(5, 18),
  },
  {
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    prdRevisionId: prdShowcaseRev,
    taskId: taskCossSelect,
    eventType: "task_started",
    payload: json({ message: "Started Coss select replacement." }),
    source: "ai",
    createdAt: ago(1, 4),
  },
  {
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    prdRevisionId: prdShowcaseRev,
    taskId: taskDirectiveValidation,
    eventType: "task_blocked",
    payload: json({ reason: "Waiting for visual review on Windows." }),
    source: "human",
    createdAt: ago(0, 8),
  },
  {
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    prdRevisionId: prdShowcaseRev,
    eventType: "review_created",
    payload: json({ reviewId: reviewHuman, phaseNumber: 2 }),
    source: "human",
    createdAt: ago(1, 3),
  },
  {
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    prdRevisionId: prdShowcaseRev,
    eventType: "phase_advanced",
    payload: json({
      phaseNumber: 2,
      suggestedCommitMessage: "feat(web): add review annotations and commit suggestions",
    }),
    source: "ai",
    createdAt: ago(0, 6),
  },
  {
    projectId: projectDepot,
    workspaceId: workspaceDepot,
    prdRevisionId: prdDoneRev2,
    taskId: taskDoneCapture,
    eventType: "task_done",
    payload: donePayload([{ path: "src/web/api/prds.ts", added: 31, removed: 7 }]),
    source: "human",
    createdAt: ago(6),
  },
]);

client.close();

console.log("Seed complete.");
console.log(`Project: Depot CLI (${projectDepot})`);
console.log(`Showcase PRD revision: ${prdShowcaseRev}`);
