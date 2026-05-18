/**
 * Rich-example seed for the local dev UI.
 *
 * Builds a single coherent project — "Acme Banking App" — with eight PRDs
 * exercising every PRD lifecycle state (draft, ready, in_progress, done,
 * canceled), multi-phase plans, multi-revision histories, and a mix of
 * human + agent reviews with findings of every severity. The activity_log
 * is populated chronologically so the UI's history view tells a story.
 *
 * Usage:
 *   DB_PATH=.depot-dev/depot.db bun run scripts/seed-rich.ts
 *
 * Defaults to .depot-dev/depot.db when DB_PATH is not set, so it never
 * touches the real ~/.depot/depot.db unless you opt in explicitly.
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "#/db/schema";
import path from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { generateId } from "#/shared/utils";

const dbPath = process.env["DB_PATH"] ?? ".depot-dev/depot.db";
const absDbPath = path.resolve(dbPath);
const dbDir = path.dirname(absDbPath);
mkdirSync(dbDir, { recursive: true });

console.log(`Seeding rich example into: ${absDbPath}`);

// Drop the existing DB file if present so the migrator starts from scratch.
for (const suffix of ["", "-shm", "-wal"]) {
  const p = absDbPath + suffix;
  if (existsSync(p)) unlinkSync(p);
}

const db = new Database(absDbPath);
// `casing` + `relations` are required for drizzle's migrator to recognize
// our schema; without them migrate() silently no-ops.
drizzle({ client: db, relations: schema.relations, casing: "snake_case" });
const migrationsFolder = path.resolve(import.meta.dirname, "../src/db/migrations");
migrate(drizzle({ client: db, relations: schema.relations, casing: "snake_case" }), {
  migrationsFolder,
});
db.exec("PRAGMA foreign_keys = ON;");
console.log("Migrations applied.");

// ── Time helpers ─────────────────────────────────────────────────────────────
//
// All timestamps anchor at "now" and walk backward so the activity feed
// reads naturally newest-first. ms-precision Date objects, converted to
// epoch-ms when written to SQLite (timestamp_ms mode).

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = (deltaMs: number) => NOW - deltaMs;

// ── Insert helpers ───────────────────────────────────────────────────────────

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: number;
};
const insertProject = (r: ProjectRow) =>
  db
    .prepare(
      "INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run(r.id, r.name, r.description, r.status, r.createdAt, r.createdAt);

type WorkspaceRow = {
  id: string;
  projectId: string;
  path: string;
  label: string | null;
  createdAt: number;
};
const insertWorkspace = (r: WorkspaceRow) =>
  db
    .prepare(
      "INSERT INTO workspaces (id, project_id, path, label, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run(r.id, r.projectId, r.path, r.label, r.createdAt, r.createdAt);

type PrdSeed = {
  id: string;
  projectId: string;
  currentRevisionId: string;
  createdAt: number;
};
const insertPrd = (r: PrdSeed) =>
  db
    .prepare(
      "INSERT INTO prds (id, project_id, current_revision_id, created_at, updated_at) VALUES (?,?,?,?,?)",
    )
    .run(r.id, r.projectId, r.currentRevisionId, r.createdAt, r.createdAt);

type RevisionSeed = {
  id: string;
  prdId: string;
  projectId: string;
  workspaceId: string | null;
  revision: number;
  title: string;
  context: string | null;
  scope: string | null;
  status: string;
  auditCycles: number;
  currentPhase: number | null;
  supersededAt: number | null;
  createdAt: number;
  updatedAt: number;
  readyAt: number | null;
  activatedAt: number | null;
};
const insertRevision = (r: RevisionSeed) =>
  db
    .prepare(
      `INSERT INTO prd_revisions
        (id, prd_id, project_id, workspace_id, revision, title, context, scope,
         status, audit_cycles, current_phase, superseded_at,
         created_at, updated_at, ready_at, activated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      r.id,
      r.prdId,
      r.projectId,
      r.workspaceId,
      r.revision,
      r.title,
      r.context,
      r.scope,
      r.status,
      r.auditCycles,
      r.currentPhase,
      r.supersededAt,
      r.createdAt,
      r.updatedAt,
      r.readyAt,
      r.activatedAt,
    );

type ReviewSeed = {
  id: string;
  prdRevisionId: string;
  type: "human" | "agent";
  status: "draft" | "in_progress" | "done";
  userFeedback: string | null;
  phaseNumber: number | null;
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
};
const insertReview = (r: ReviewSeed) =>
  db
    .prepare(
      `INSERT INTO reviews
        (id, prd_revision_id, type, status, user_feedback, phase_number,
         created_at, updated_at, done_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      r.id,
      r.prdRevisionId,
      r.type,
      r.status,
      r.userFeedback,
      r.phaseNumber,
      r.createdAt,
      r.updatedAt,
      r.doneAt,
    );

type TaskSeed = {
  id: string;
  prdRevisionId: string;
  position: number;
  title: string;
  description: string;
  doneCriteria: string;
  dependsOn: string[];
  effort: "xs" | "s" | "m" | "l" | "xl";
  phaseNumber: number | null;
  status: "pending" | "in_progress" | "blocked" | "done" | "skipped";
  reviewId: string | null;
  severity: "critical" | "major" | "minor" | "info" | null;
  blockedReason: string | null;
  skipReason: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
};
const insertTask = (r: TaskSeed) =>
  db
    .prepare(
      `INSERT INTO tasks
        (id, prd_revision_id, position, title, description, description_format,
         done_criteria, depends_on, effort, phase_number, status,
         review_id, severity, blocked_reason, skip_reason,
         created_at, started_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      r.id,
      r.prdRevisionId,
      r.position,
      r.title,
      r.description,
      "structured_v1",
      r.doneCriteria,
      JSON.stringify(r.dependsOn),
      r.effort,
      r.phaseNumber,
      r.status,
      r.reviewId,
      r.severity,
      r.blockedReason,
      r.skipReason,
      r.createdAt,
      r.startedAt,
      r.completedAt,
    );

type ActivitySeed = {
  projectId: string;
  workspaceId: string | null;
  prdRevisionId: string | null;
  taskId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: number;
};
const insertActivity = (r: ActivitySeed) =>
  db
    .prepare(
      `INSERT INTO activity_log
        (id, project_id, workspace_id, prd_revision_id, task_id,
         event_type, payload, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      generateId(),
      r.projectId,
      r.workspaceId,
      r.prdRevisionId,
      r.taskId,
      r.eventType,
      JSON.stringify(r.payload),
      r.createdAt,
    );

// ── Project + workspace ──────────────────────────────────────────────────────

const PROJECT_ID = generateId();
const WS_ID = generateId();
const WS_FEATURE_ID = generateId();
const WS_PATH = "/home/dev/workspaces/acme-banking";

insertProject({
  id: PROJECT_ID,
  name: "Acme Banking",
  description: "Mobile banking app — production roadmap (rich seed)",
  status: "active",
  createdAt: T(45 * DAY),
});
insertWorkspace({
  id: WS_ID,
  projectId: PROJECT_ID,
  path: WS_PATH,
  label: "main",
  createdAt: T(45 * DAY),
});
insertWorkspace({
  id: WS_FEATURE_ID,
  projectId: PROJECT_ID,
  path: `${WS_PATH}-feature-checkout`,
  label: "feature/checkout",
  createdAt: T(20 * DAY),
});

// Helper: log a base set of lifecycle events for a revision.
type LifecycleEvent = { eventType: string; at: number; payload?: Record<string, unknown> };
const logRevision = (revisionId: string, workspaceId: string | null, events: LifecycleEvent[]) => {
  for (const e of events) {
    insertActivity({
      projectId: PROJECT_ID,
      workspaceId,
      prdRevisionId: revisionId,
      taskId: null,
      eventType: e.eventType,
      payload: e.payload ?? {},
      createdAt: e.at,
    });
  }
};

// ── PRD #1: User auth & onboarding (DONE, 2 revisions, 2 reviews) ────────────
//
// First revision shipped, then forked to add a found-late requirement
// (passwordless magic-link). Both revisions are now done.

const PRD1 = generateId();
const REV1A = generateId();
const REV1B = generateId();

insertPrd({
  id: PRD1,
  projectId: PROJECT_ID,
  currentRevisionId: REV1B,
  createdAt: T(40 * DAY),
});
insertRevision({
  id: REV1A,
  prdId: PRD1,
  projectId: PROJECT_ID,
  workspaceId: WS_ID,
  revision: 1,
  title: "User authentication & onboarding",
  context:
    "First-time users need a secure but friendly path from app install to authenticated session. Today the prototype hard-codes a single hard-coded user; we need a real signup, login, and password recovery flow before we can ship to staging.",
  scope:
    "**In scope:** email + password signup, password login, password reset via emailed token, session persistence across cold starts, biometric step-up for transfers.\n\n**Out of scope:** social login (Google/Apple — separate PRD), passwordless / magic-link (filed separately), enterprise SSO.",
  status: "done",
  auditCycles: 2,
  currentPhase: null,
  supersededAt: T(15 * DAY),
  createdAt: T(40 * DAY),
  updatedAt: T(15 * DAY),
  readyAt: T(38 * DAY),
  activatedAt: T(37 * DAY),
});
insertRevision({
  id: REV1B,
  prdId: PRD1,
  projectId: PROJECT_ID,
  workspaceId: WS_ID,
  revision: 2,
  title: "User authentication & onboarding",
  context:
    "Forked from rev 1 after security review flagged that password-only login was no longer acceptable for the regulated banking vertical we are targeting (PSD2 SCA). Adds passwordless magic-link as a co-equal path. Rev 1 is preserved for audit trail.",
  scope:
    "**In scope:** everything from rev 1 plus passwordless magic-link login, fallback when biometric is disabled, audit-log entries for every auth event.\n\n**Out of scope:** WebAuthn / passkeys (next quarter).",
  status: "done",
  auditCycles: 1,
  currentPhase: null,
  supersededAt: null,
  createdAt: T(15 * DAY),
  updatedAt: T(8 * DAY),
  readyAt: T(14 * DAY),
  activatedAt: T(14 * DAY),
});

// Reviews on rev 1
const REV1A_AGENT_REVIEW = generateId();
const REV1A_HUMAN_REVIEW = generateId();
insertReview({
  id: REV1A_AGENT_REVIEW,
  prdRevisionId: REV1A,
  type: "agent",
  status: "done",
  userFeedback: null,
  phaseNumber: null,
  createdAt: T(36 * DAY),
  updatedAt: T(35 * DAY),
  doneAt: T(35 * DAY),
});
insertReview({
  id: REV1A_HUMAN_REVIEW,
  prdRevisionId: REV1A,
  type: "human",
  status: "done",
  userFeedback:
    "Looks good after the agent's findings landed. Two small UX nits I want addressed before merge — logged below.",
  phaseNumber: null,
  createdAt: T(34 * DAY),
  updatedAt: T(33 * DAY),
  doneAt: T(33 * DAY),
});
const REV1B_AGENT_REVIEW = generateId();
insertReview({
  id: REV1B_AGENT_REVIEW,
  prdRevisionId: REV1B,
  type: "agent",
  status: "done",
  userFeedback: null,
  phaseNumber: null,
  createdAt: T(11 * DAY),
  updatedAt: T(10 * DAY),
  doneAt: T(10 * DAY),
});

// Tasks on rev 1 (PRD-level)
const PRD1_TASKS_BASE = [
  ["Wire up Supabase auth client", "Plug the Supabase JS SDK into the app shell.", "s", "done"],
  ["Signup screen", "Email + password fields with strength meter.", "m", "done"],
  ["Login screen", "Email/password + biometric step-up.", "m", "done"],
  ["Password-reset email flow", "Token-based reset with 30-min expiry.", "m", "done"],
  ["Session persistence", "Keep auth across cold starts via secure storage.", "s", "done"],
  [
    "Audit-log every auth event",
    "Add structured logs for sign-in / sign-out / failures.",
    "s",
    "done",
  ],
] as const;
let pos = 1;
for (const [title, desc, effort, status] of PRD1_TASKS_BASE) {
  insertTask({
    id: generateId(),
    prdRevisionId: REV1A,
    position: pos++,
    title,
    description: desc,
    doneCriteria: `Verified by code review and a green run of tests/auth/${title.toLowerCase().replace(/\W+/g, "-")}.test.ts`,
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: null,
    status: status as TaskSeed["status"],
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: T(40 * DAY) + pos * 10_000,
    startedAt: T(36 * DAY) + pos * HOUR,
    completedAt: T(34 * DAY) + pos * HOUR,
  });
}

// Findings on rev 1 agent review
const PRD1_AGENT_FINDINGS = [
  ["Token expiry not validated server-side", "critical", "done"],
  ["Password strength meter accepts known-leaked passwords", "major", "done"],
  ["Login screen logs the email at debug level", "major", "done"],
  ["Inconsistent button copy: 'Continue' vs 'Sign in'", "minor", "done"],
  ["Missing aria-label on the back button", "minor", "skipped"],
] as const;
let fpos = 1;
for (const [title, severity, status] of PRD1_AGENT_FINDINGS) {
  insertTask({
    id: generateId(),
    prdRevisionId: REV1A,
    position: fpos++,
    title,
    description: `Agent audit finding (cycle 1): ${title}.`,
    doneCriteria: "Auditor re-runs and the issue is no longer reported.",
    dependsOn: [],
    effort: "s",
    phaseNumber: null,
    status: status as TaskSeed["status"],
    reviewId: REV1A_AGENT_REVIEW,
    severity: severity as TaskSeed["severity"],
    blockedReason: null,
    skipReason: status === "skipped" ? "info-only: deferred to accessibility audit PRD" : null,
    createdAt: T(36 * DAY) + fpos * 10_000,
    startedAt: T(36 * DAY) + fpos * HOUR,
    completedAt: status === "skipped" ? T(35 * DAY) : T(35 * DAY) + fpos * HOUR,
  });
}

// Findings on rev 1 human review
const PRD1_HUMAN_FINDINGS = [
  ["Onboarding copy reads as too formal", "minor", "done"],
  ["Logo placement on signup screen feels off-center", "minor", "done"],
] as const;
let hpos = 1;
for (const [title, severity, status] of PRD1_HUMAN_FINDINGS) {
  insertTask({
    id: generateId(),
    prdRevisionId: REV1A,
    position: hpos++,
    title,
    description: `Human review finding: ${title}.`,
    doneCriteria: "Reviewer confirms the change in person on the next demo.",
    dependsOn: [],
    effort: "xs",
    phaseNumber: null,
    status: status as TaskSeed["status"],
    reviewId: REV1A_HUMAN_REVIEW,
    severity: severity as TaskSeed["severity"],
    blockedReason: null,
    skipReason: null,
    createdAt: T(34 * DAY) + hpos * 10_000,
    startedAt: T(34 * DAY) + hpos * HOUR,
    completedAt: T(33 * DAY) + hpos * HOUR,
  });
}

// Tasks on rev 2 (single new task added by the fork)
const PRD1_REV2_TASKS = [
  [
    "Implement passwordless magic-link",
    "Send a signed link via email; redeem within 15 min.",
    "m",
    "done",
  ],
  ["Audit-log magic-link redemptions", "Same shape as password login events.", "xs", "done"],
] as const;
let r2pos = 1;
for (const [title, desc, effort, status] of PRD1_REV2_TASKS) {
  insertTask({
    id: generateId(),
    prdRevisionId: REV1B,
    position: r2pos++,
    title,
    description: desc,
    doneCriteria: "Tests pass and an end-to-end demo on staging succeeds.",
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: null,
    status: status as TaskSeed["status"],
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: T(15 * DAY) + r2pos * 10_000,
    startedAt: T(13 * DAY) + r2pos * HOUR,
    completedAt: T(9 * DAY) + r2pos * HOUR,
  });
}

logRevision(REV1A, WS_ID, [
  { eventType: "prd_created", at: T(40 * DAY), payload: { revision: 1 } },
  { eventType: "prd_updated", at: T(39 * DAY), payload: { fields: ["context", "scope"] } },
  { eventType: "prd_ready", at: T(38 * DAY) },
  { eventType: "prd_activated", at: T(37 * DAY) },
  { eventType: "review_created", at: T(36 * DAY), payload: { type: "agent" } },
  { eventType: "review_done", at: T(35 * DAY), payload: { type: "agent", findings: 5 } },
  { eventType: "review_created", at: T(34 * DAY), payload: { type: "human" } },
  { eventType: "review_done", at: T(33 * DAY), payload: { type: "human", findings: 2 } },
  { eventType: "prd_done", at: T(30 * DAY) },
  { eventType: "prd_forked", at: T(15 * DAY), payload: { newRevisionId: REV1B } },
]);
logRevision(REV1B, WS_ID, [
  { eventType: "prd_created", at: T(15 * DAY), payload: { revision: 2, forkedFrom: REV1A } },
  { eventType: "prd_ready", at: T(14 * DAY) },
  { eventType: "prd_activated", at: T(14 * DAY) },
  { eventType: "review_created", at: T(11 * DAY), payload: { type: "agent" } },
  { eventType: "review_done", at: T(10 * DAY), payload: { type: "agent", findings: 0 } },
  { eventType: "prd_done", at: T(8 * DAY) },
  {
    eventType: "prd_approved",
    at: T(8 * DAY),
    payload: { approvedBy: "kristen", comment: "Ship it." },
  },
]);

// ── PRD #2: Payment checkout flow (IN_PROGRESS, multi-phase, mid-flight) ─────

const PRD2 = generateId();
const REV2 = generateId();
insertPrd({ id: PRD2, projectId: PROJECT_ID, currentRevisionId: REV2, createdAt: T(20 * DAY) });
insertRevision({
  id: REV2,
  prdId: PRD2,
  projectId: PROJECT_ID,
  workspaceId: WS_FEATURE_ID,
  revision: 1,
  title: "Payment checkout flow",
  context:
    "Users can browse the merchant catalog but cannot pay. Checkout is the single biggest revenue blocker. PSD2 SCA must apply on every transaction over the small-amount threshold.",
  scope:
    "**In scope:** cart → confirm → 3DS → success/failure screens; saved cards; SCA challenge handling; idempotency keys end-to-end.\n\n**Out of scope:** subscriptions (separate PRD), refunds (post-launch), in-app credit.",
  // Phase 2 just landed an audit; the orchestrator parked the PRD at the
  // human-validation gate. Currently sitting in `review` while the user
  // walks through the staging build — exercises the new dedicated column.
  status: "review",
  auditCycles: 1,
  currentPhase: 2,
  supersededAt: null,
  createdAt: T(20 * DAY),
  updatedAt: T(2 * HOUR),
  readyAt: T(18 * DAY),
  activatedAt: T(17 * DAY),
});

// Phase 1 — done
const PRD2_PHASE1 = [
  ["Cart → confirm screen", "Show line items + total + CTA.", "m", "done"],
  ["Backend cart-totals endpoint", "Authoritative totals (server, never client).", "s", "done"],
  ["Saved-cards picker", "Reuse existing cards via tokenization.", "m", "done"],
] as const;
let p1pos = 1;
for (const [title, desc, effort, status] of PRD2_PHASE1) {
  insertTask({
    id: generateId(),
    prdRevisionId: REV2,
    position: p1pos++,
    title,
    description: desc,
    doneCriteria: "Targeted Playwright test green; manual smoke OK.",
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: 1,
    status: status as TaskSeed["status"],
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: T(20 * DAY) + p1pos * 10_000,
    startedAt: T(17 * DAY) + p1pos * HOUR,
    completedAt: T(12 * DAY) + p1pos * HOUR,
  });
}

// Phase 1 audit (done)
const PRD2_P1_AUDIT = generateId();
insertReview({
  id: PRD2_P1_AUDIT,
  prdRevisionId: REV2,
  type: "agent",
  status: "done",
  userFeedback: null,
  phaseNumber: 1,
  createdAt: T(11 * DAY),
  updatedAt: T(10 * DAY),
  doneAt: T(10 * DAY),
});
const PRD2_P1_FINDINGS = [
  ["Cart total recomputed client-side on every keystroke", "major", "done"],
  ["Saved-card picker leaks last-4 in console.log", "minor", "done"],
] as const;
for (let i = 0; i < PRD2_P1_FINDINGS.length; i++) {
  const [title, severity, status] = PRD2_P1_FINDINGS[i]!;
  insertTask({
    id: generateId(),
    prdRevisionId: REV2,
    position: i + 1,
    title,
    description: `Phase 1 audit finding: ${title}.`,
    doneCriteria: "Auditor re-runs and the finding is gone.",
    dependsOn: [],
    effort: "s",
    phaseNumber: 1,
    status: status as TaskSeed["status"],
    reviewId: PRD2_P1_AUDIT,
    severity: severity as TaskSeed["severity"],
    blockedReason: null,
    skipReason: null,
    createdAt: T(11 * DAY) + i * 10_000,
    startedAt: T(11 * DAY) + i * HOUR,
    completedAt: T(10 * DAY) + i * HOUR,
  });
}

// Phase 2 — currently mid-flight (some done, some in_progress, 1 blocked)
const PRD2_PHASE2 = [
  ["3DS challenge component", "Native bottom sheet with the bank's challenge UI.", "l", "done"],
  [
    "Idempotency-key plumbing",
    "Generate per-attempt key, retry-safe to gateway.",
    "m",
    "in_progress",
  ],
  ["Network error handling on confirm", "Retry-with-backoff + clear user message.", "m", "blocked"],
  [
    "Capture analytics for funnel drop-off",
    "Event for every screen + every error class.",
    "s",
    "pending",
  ],
] as const;
let p2pos = 1;
for (const [title, desc, effort, status] of PRD2_PHASE2) {
  const blocked = status === "blocked";
  insertTask({
    id: generateId(),
    prdRevisionId: REV2,
    position: p2pos++,
    title,
    description: desc,
    doneCriteria: "Targeted test green + recorded successful demo.",
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: 2,
    status: status as TaskSeed["status"],
    reviewId: null,
    severity: null,
    blockedReason: blocked
      ? "Waiting on payment-gateway sandbox creds from the vendor (ticket #ACME-4421, ETA tomorrow)."
      : null,
    skipReason: null,
    createdAt: T(8 * DAY) + p2pos * 10_000,
    startedAt: status === "pending" ? null : T(5 * DAY) + p2pos * HOUR,
    completedAt: status === "done" ? T(3 * DAY) + p2pos * HOUR : null,
  });
}

// In-progress human review on phase 2
const PRD2_P2_HUMAN_REVIEW = generateId();
insertReview({
  id: PRD2_P2_HUMAN_REVIEW,
  prdRevisionId: REV2,
  type: "human",
  status: "in_progress",
  userFeedback:
    "Tested on the staging build today — couple of issues that need to land before we push to TestFlight. Nothing blocking the architecture, just polish + one accessibility miss.",
  phaseNumber: 2,
  createdAt: T(2 * DAY),
  updatedAt: T(4 * HOUR),
  doneAt: null,
});
const PRD2_P2_HUMAN_FINDINGS = [
  ["3DS sheet has no Cancel button when challenge times out", "major", "in_progress"],
  ["Loading spinner overlaps the amount text on slow renders", "minor", "pending"],
  ["Screen reader: total amount reads as a string of digits, not currency", "major", "pending"],
] as const;
for (let i = 0; i < PRD2_P2_HUMAN_FINDINGS.length; i++) {
  const [title, severity, status] = PRD2_P2_HUMAN_FINDINGS[i]!;
  insertTask({
    id: generateId(),
    prdRevisionId: REV2,
    position: i + 1,
    title,
    description: `Phase 2 human review finding: ${title}.`,
    doneCriteria: "Reviewer signs off in person on the next demo.",
    dependsOn: [],
    effort: "s",
    phaseNumber: 2,
    status: status as TaskSeed["status"],
    reviewId: PRD2_P2_HUMAN_REVIEW,
    severity: severity as TaskSeed["severity"],
    blockedReason: null,
    skipReason: null,
    createdAt: T(2 * DAY) + i * 10_000,
    startedAt: status === "pending" ? null : T(2 * DAY) + i * HOUR,
    completedAt: null,
  });
}

// Phase 3 — pending (not started)
const PRD2_PHASE3 = [
  ["Success screen with order summary", "Friendly receipt + share/PDF export.", "m"],
  ["Failure screen with retry path", "Surface bank decline reason verbatim.", "s"],
  ["Background sync of order status", "Poll-on-resume if the app is backgrounded.", "m"],
] as const;
let p3pos = 1;
for (const [title, desc, effort] of PRD2_PHASE3) {
  insertTask({
    id: generateId(),
    prdRevisionId: REV2,
    position: p3pos++,
    title,
    description: desc,
    doneCriteria: "Targeted Playwright test green; demo OK.",
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: 3,
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: T(20 * DAY) + p3pos * 10_000,
    startedAt: null,
    completedAt: null,
  });
}

logRevision(REV2, WS_FEATURE_ID, [
  { eventType: "prd_created", at: T(20 * DAY), payload: { revision: 1 } },
  { eventType: "prd_updated", at: T(19 * DAY), payload: { fields: ["context", "scope"] } },
  { eventType: "prd_ready", at: T(18 * DAY) },
  { eventType: "prd_activated", at: T(17 * DAY) },
  { eventType: "phase_advanced", at: T(11 * DAY), payload: { fromPhase: 1, toPhase: 2 } },
  { eventType: "review_created", at: T(11 * DAY), payload: { type: "agent", phase: 1 } },
  { eventType: "review_done", at: T(10 * DAY), payload: { type: "agent", findings: 2 } },
  { eventType: "review_created", at: T(2 * DAY), payload: { type: "human", phase: 2 } },
  { eventType: "review_started", at: T(2 * DAY), payload: { type: "human" } },
  { eventType: "task_blocked", at: T(1 * DAY), payload: { reason: "vendor sandbox creds" } },
  {
    eventType: "prd_review_requested",
    at: T(2 * DAY),
    payload: { phase: 2, reason: "phase-2 audit clean — handing to product for sign-off" },
  },
]);

// ── PRD #3: Push notifications (READY, awaiting activation) ──────────────────

const PRD3 = generateId();
const REV3 = generateId();
insertPrd({ id: PRD3, projectId: PROJECT_ID, currentRevisionId: REV3, createdAt: T(12 * DAY) });
insertRevision({
  id: REV3,
  prdId: PRD3,
  projectId: PROJECT_ID,
  workspaceId: null,
  revision: 1,
  title: "Push notifications system",
  context:
    "Today users only learn about a transaction when they reopen the app. Push for high-signal events (received transfer, low balance, SCA challenge) is the smallest change with the largest engagement uplift per the Q3 analytics.",
  scope:
    "**In scope:** APNs + FCM integration, server-side notification template registry (5 initial templates), per-user preferences, deep-link from notification to in-app screen.\n\n**Out of scope:** rich notifications with images, web push, marketing pushes (legal review pending).",
  status: "ready",
  auditCycles: 0,
  currentPhase: null,
  supersededAt: null,
  createdAt: T(12 * DAY),
  updatedAt: T(9 * DAY),
  readyAt: T(9 * DAY),
  activatedAt: null,
});
const PRD3_TASKS = [
  ["APNs + FCM client integration", "Wire native SDKs for both platforms.", "m"],
  ["Template registry on the server", "DSL → string pipeline, 5 initial templates.", "m"],
  ["Per-user preferences screen", "Toggle per-template; persist server-side.", "s"],
  ["Deep-link from notification payload", "Route to the screen named in the payload.", "s"],
] as const;
for (let i = 0; i < PRD3_TASKS.length; i++) {
  const [title, desc, effort] = PRD3_TASKS[i]!;
  insertTask({
    id: generateId(),
    prdRevisionId: REV3,
    position: i + 1,
    title,
    description: desc,
    doneCriteria: "Targeted test green; manual notification triggered from the staging admin tool.",
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: null,
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: T(12 * DAY) + i * 10_000,
    startedAt: null,
    completedAt: null,
  });
}
logRevision(REV3, WS_ID, [
  { eventType: "prd_created", at: T(12 * DAY) },
  { eventType: "prd_updated", at: T(11 * DAY), payload: { fields: ["context", "scope"] } },
  { eventType: "prd_ready", at: T(9 * DAY) },
]);

// ── PRD #4: Account statements export (IN_PROGRESS, mid audit cycle) ─────────

const PRD4 = generateId();
const REV4 = generateId();
insertPrd({ id: PRD4, projectId: PROJECT_ID, currentRevisionId: REV4, createdAt: T(10 * DAY) });
insertRevision({
  id: REV4,
  prdId: PRD4,
  projectId: PROJECT_ID,
  workspaceId: WS_ID,
  revision: 1,
  title: "Account statements export — PDF & CSV",
  context:
    "Customers regularly request statements in machine-readable format for their accountants. CSV is the most-requested; PDF is a regulatory must.",
  scope:
    "**In scope:** signed PDF (per-month and custom range), CSV (RFC 4180), email delivery to the account owner's verified email, download link with 24h expiry.\n\n**Out of scope:** OFX / QFX, signed-XML for tax authorities, third-party-app pull API.",
  status: "in_progress",
  auditCycles: 1,
  currentPhase: null,
  supersededAt: null,
  createdAt: T(10 * DAY),
  updatedAt: T(6 * HOUR),
  readyAt: T(8 * DAY),
  activatedAt: T(7 * DAY),
});
const PRD4_TASKS = [
  ["CSV export endpoint", "Stream RFC-4180 with proper escaping.", "s", "done"],
  ["PDF export endpoint", "Server-rendered, signed.", "m", "in_progress"],
  ["Email delivery via SES", "From the verified domain; bounce handling.", "s", "pending"],
  ["Download link with 24h expiry", "Pre-signed URL pattern.", "s", "pending"],
] as const;
for (let i = 0; i < PRD4_TASKS.length; i++) {
  const [title, desc, effort, status] = PRD4_TASKS[i]!;
  insertTask({
    id: generateId(),
    prdRevisionId: REV4,
    position: i + 1,
    title,
    description: desc,
    doneCriteria: "Targeted test green; verifiable file generated.",
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: null,
    status: status as TaskSeed["status"],
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: T(10 * DAY) + i * 10_000,
    startedAt: status === "pending" ? null : T(6 * DAY) + i * HOUR,
    completedAt: status === "done" ? T(4 * DAY) : null,
  });
}

// In-progress audit with critical findings (the user must fix)
const PRD4_AUDIT = generateId();
insertReview({
  id: PRD4_AUDIT,
  prdRevisionId: REV4,
  type: "agent",
  status: "in_progress",
  userFeedback: null,
  phaseNumber: null,
  createdAt: T(8 * HOUR),
  updatedAt: T(2 * HOUR),
  doneAt: null,
});
const PRD4_FINDINGS = [
  ["CSV export does not enforce per-account authorization", "critical", "pending"],
  ["PDF generation runs unauthenticated on the public worker pool", "critical", "in_progress"],
  ["Filename leaks the customer's full name in a 24h-cached URL", "major", "pending"],
  ["No rate-limit on the export endpoint", "major", "pending"],
  ["CSV mixes ISO-8601 and dd/mm/yyyy in two columns", "minor", "pending"],
] as const;
for (let i = 0; i < PRD4_FINDINGS.length; i++) {
  const [title, severity, status] = PRD4_FINDINGS[i]!;
  insertTask({
    id: generateId(),
    prdRevisionId: REV4,
    position: i + 1,
    title,
    description: `Auditor finding (cycle 1): ${title}.`,
    doneCriteria: "Auditor re-runs and finding is gone.",
    dependsOn: [],
    effort: "s",
    phaseNumber: null,
    status: status as TaskSeed["status"],
    reviewId: PRD4_AUDIT,
    severity: severity as TaskSeed["severity"],
    blockedReason: null,
    skipReason: null,
    createdAt: T(8 * HOUR) + i * 10_000,
    startedAt: status === "in_progress" ? T(4 * HOUR) : null,
    completedAt: null,
  });
}
logRevision(REV4, WS_ID, [
  { eventType: "prd_created", at: T(10 * DAY) },
  { eventType: "prd_ready", at: T(8 * DAY) },
  { eventType: "prd_activated", at: T(7 * DAY) },
  { eventType: "review_created", at: T(8 * HOUR), payload: { type: "agent" } },
  { eventType: "review_started", at: T(7 * HOUR), payload: { type: "agent" } },
]);

// ── PRD #5: Dark mode redesign (DRAFT, lean) ─────────────────────────────────

const PRD5 = generateId();
const REV5 = generateId();
insertPrd({ id: PRD5, projectId: PROJECT_ID, currentRevisionId: REV5, createdAt: T(2 * DAY) });
insertRevision({
  id: REV5,
  prdId: PRD5,
  projectId: PROJECT_ID,
  workspaceId: null,
  revision: 1,
  title: "Dark mode redesign",
  context:
    "The current dark mode is a token flip applied late in the cycle; contrast fails WCAG AA on three screens and the brand colors look muddy. Need a real redesign pass before our App Store feature in November.",
  scope: null,
  status: "draft",
  auditCycles: 0,
  currentPhase: null,
  supersededAt: null,
  createdAt: T(2 * DAY),
  updatedAt: T(20 * MIN),
  readyAt: null,
  activatedAt: null,
});
const PRD5_TASKS = [
  ["Audit current dark-mode screens for WCAG AA", "Compile contrast report.", "s"],
  ["Propose new token palette", "Cover backgrounds, foregrounds, semantic accent.", "s"],
] as const;
for (let i = 0; i < PRD5_TASKS.length; i++) {
  const [title, desc, effort] = PRD5_TASKS[i]!;
  insertTask({
    id: generateId(),
    prdRevisionId: REV5,
    position: i + 1,
    title,
    description: desc,
    doneCriteria: "Output document or PR linked here.",
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: null,
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: T(2 * DAY) + i * 10_000,
    startedAt: null,
    completedAt: null,
  });
}
logRevision(REV5, WS_ID, [
  { eventType: "prd_created", at: T(2 * DAY) },
  { eventType: "prd_updated", at: T(45 * MIN), payload: { fields: ["context"] } },
  { eventType: "task_created", at: T(20 * MIN) },
]);

// ── PRD #6: Biometric login (DONE, clean) ────────────────────────────────────

const PRD6 = generateId();
const REV6 = generateId();
insertPrd({ id: PRD6, projectId: PROJECT_ID, currentRevisionId: REV6, createdAt: T(28 * DAY) });
insertRevision({
  id: REV6,
  prdId: PRD6,
  projectId: PROJECT_ID,
  workspaceId: WS_ID,
  revision: 1,
  title: "Biometric login (Face ID / Touch ID)",
  context:
    "Once a user has signed in once with a password, subsequent unlocks should use the platform biometric. Cuts time-to-balance from ~6s to ~1s per the device-lab study.",
  scope:
    "**In scope:** opt-in screen after first successful login, biometric prompt on app launch, fallback to password.\n\n**Out of scope:** PIN code as additional fallback (filed as future).",
  status: "done",
  auditCycles: 1,
  currentPhase: null,
  supersededAt: null,
  createdAt: T(28 * DAY),
  updatedAt: T(22 * DAY),
  readyAt: T(27 * DAY),
  activatedAt: T(27 * DAY),
});
const PRD6_TASKS = [
  ["Opt-in screen post first login", "Light explainer + Enable / Skip.", "s", "done"],
  [
    "Biometric prompt on app launch",
    "iOS LocalAuthentication / Android BiometricPrompt.",
    "m",
    "done",
  ],
  ["Fallback path to password", "Triggered after 3 failed biometric attempts.", "s", "done"],
] as const;
for (let i = 0; i < PRD6_TASKS.length; i++) {
  const [title, desc, effort, status] = PRD6_TASKS[i]!;
  insertTask({
    id: generateId(),
    prdRevisionId: REV6,
    position: i + 1,
    title,
    description: desc,
    doneCriteria: "On-device verification on iOS + Android.",
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: null,
    status: status as TaskSeed["status"],
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: T(28 * DAY) + i * 10_000,
    startedAt: T(26 * DAY) + i * HOUR,
    completedAt: T(24 * DAY) + i * HOUR,
  });
}
const PRD6_AUDIT = generateId();
insertReview({
  id: PRD6_AUDIT,
  prdRevisionId: REV6,
  type: "agent",
  status: "done",
  userFeedback: null,
  phaseNumber: null,
  createdAt: T(23 * DAY),
  updatedAt: T(23 * DAY),
  doneAt: T(23 * DAY),
});
logRevision(REV6, WS_ID, [
  { eventType: "prd_created", at: T(28 * DAY) },
  { eventType: "prd_ready", at: T(27 * DAY) },
  { eventType: "prd_activated", at: T(27 * DAY) },
  { eventType: "review_created", at: T(23 * DAY), payload: { type: "agent" } },
  { eventType: "review_done", at: T(23 * DAY), payload: { type: "agent", findings: 0 } },
  { eventType: "prd_done", at: T(22 * DAY) },
  {
    eventType: "prd_approved",
    at: T(22 * DAY),
    payload: { approvedBy: "kristen", comment: "Clean ship." },
  },
]);

// ── PRD #7: Card freeze/unfreeze (CANCELED) ──────────────────────────────────

const PRD7 = generateId();
const REV7 = generateId();
insertPrd({ id: PRD7, projectId: PROJECT_ID, currentRevisionId: REV7, createdAt: T(18 * DAY) });
insertRevision({
  id: REV7,
  prdId: PRD7,
  projectId: PROJECT_ID,
  workspaceId: null,
  revision: 1,
  title: "Card freeze / unfreeze controls",
  context:
    "Users want to freeze a card from the app instead of calling support. Standard banking-app feature.",
  scope:
    "**In scope:** toggle in card detail screen, server-side freeze that blocks new authorizations, audit-log entry.",
  status: "canceled",
  auditCycles: 0,
  currentPhase: null,
  supersededAt: null,
  createdAt: T(18 * DAY),
  updatedAt: T(16 * DAY),
  readyAt: null,
  activatedAt: null,
});
logRevision(REV7, WS_ID, [
  { eventType: "prd_created", at: T(18 * DAY) },
  {
    eventType: "prd_canceled",
    at: T(16 * DAY),
    payload: {
      reason: "Vendor will ship this server-side natively in Q4 — work moves to integration.",
    },
  },
]);

// ── PRD #8: Transfer between accounts (IN_PROGRESS, 2 revisions) ─────────────

const PRD8 = generateId();
const REV8A = generateId();
const REV8B = generateId();
insertPrd({ id: PRD8, projectId: PROJECT_ID, currentRevisionId: REV8B, createdAt: T(33 * DAY) });
insertRevision({
  id: REV8A,
  prdId: PRD8,
  projectId: PROJECT_ID,
  workspaceId: WS_ID,
  revision: 1,
  title: "Transfer between own accounts",
  context:
    "Users with multiple accounts want to move money between them in-app instead of via the website.",
  scope:
    "**In scope:** account-to-account transfer for accounts owned by the same user, instant settlement, full audit-log entry.",
  status: "done",
  auditCycles: 1,
  currentPhase: null,
  supersededAt: T(7 * DAY),
  createdAt: T(33 * DAY),
  updatedAt: T(7 * DAY),
  readyAt: T(31 * DAY),
  activatedAt: T(30 * DAY),
});
insertRevision({
  id: REV8B,
  prdId: PRD8,
  projectId: PROJECT_ID,
  workspaceId: WS_ID,
  revision: 2,
  title: "Transfer between own accounts",
  context:
    "Forked from rev 1 after legal flagged that joint-account holders need explicit consent before a transfer can debit the joint account. Adds the consent flow and the receipts spec they want.",
  scope:
    "**In scope:** rev 1 + joint-account consent (two-tap confirm by the second holder), itemized receipt PDF, scheduled transfers up to 30 days out.",
  status: "in_progress",
  auditCycles: 0,
  currentPhase: null,
  supersededAt: null,
  createdAt: T(7 * DAY),
  updatedAt: T(1 * DAY),
  readyAt: T(6 * DAY),
  activatedAt: T(5 * DAY),
});
const PRD8_REV2_TASKS = [
  [
    "Joint-account consent flow",
    "Two-tap confirm by the second account holder.",
    "l",
    "in_progress",
  ],
  ["Itemized receipt PDF", "Reuse the statements export pipeline.", "m", "pending"],
  ["Scheduled transfers", "Cron-driven execution up to 30 days out.", "m", "pending"],
] as const;
for (let i = 0; i < PRD8_REV2_TASKS.length; i++) {
  const [title, desc, effort, status] = PRD8_REV2_TASKS[i]!;
  insertTask({
    id: generateId(),
    prdRevisionId: REV8B,
    position: i + 1,
    title,
    description: desc,
    doneCriteria: "Targeted test green; legal sign-off on the consent flow.",
    dependsOn: [],
    effort: effort as TaskSeed["effort"],
    phaseNumber: null,
    status: status as TaskSeed["status"],
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: T(7 * DAY) + i * 10_000,
    startedAt: status === "pending" ? null : T(3 * DAY),
    completedAt: null,
  });
}
logRevision(REV8A, WS_ID, [
  { eventType: "prd_created", at: T(33 * DAY) },
  { eventType: "prd_ready", at: T(31 * DAY) },
  { eventType: "prd_activated", at: T(30 * DAY) },
  { eventType: "prd_done", at: T(20 * DAY) },
  {
    eventType: "prd_forked",
    at: T(7 * DAY),
    payload: { newRevisionId: REV8B, reason: "legal: joint-account consent" },
  },
]);
logRevision(REV8B, WS_ID, [
  { eventType: "prd_created", at: T(7 * DAY), payload: { revision: 2, forkedFrom: REV8A } },
  { eventType: "prd_ready", at: T(6 * DAY) },
  { eventType: "prd_activated", at: T(5 * DAY) },
]);

// ── Done ─────────────────────────────────────────────────────────────────────

const summary = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM projects)            AS projects,
       (SELECT COUNT(*) FROM workspaces)          AS workspaces,
       (SELECT COUNT(DISTINCT prd_id) FROM prd_revisions) AS prds,
       (SELECT COUNT(*) FROM prd_revisions)       AS revisions,
       (SELECT COUNT(*) FROM tasks)               AS tasks,
       (SELECT COUNT(*) FROM reviews)             AS reviews,
       (SELECT COUNT(*) FROM activity_log)        AS events`,
  )
  .get();
console.log("Seed complete:", summary);
db.close();
