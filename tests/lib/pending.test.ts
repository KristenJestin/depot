import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, makeRun } from "../helpers/db";
import {
  pushPendingAction,
  listPendingActions,
  consumePendingAction,
  dismissPendingAction,
  autoDismissExpired,
} from "#/modules/pending/domain";
import { createProject } from "#/modules/projects/domain";
import { eq } from "drizzle-orm";
import { pendingActions } from "#/db/schema";
import type { Database } from "#/db/client";

describe("pending actions domain", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    const result = createTestDb();
    db = result.db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
  });

  it("pushes and lists a pending action", async () => {
    await run(
      pushPendingAction({
        projectId,
        kind: "resume-with-review",
        slashCommand: "/depot-dev FOO",
        humanReadableLabel: "Resume PRD FOO",
      }),
    );
    const items = await run(listPendingActions(projectId, { status: "pending" }));
    expect(items).toHaveLength(1);
    expect(items[0]?.slashCommand).toBe("/depot-dev FOO");
  });

  it("deduplicates identical pending actions", async () => {
    const first = await run(
      pushPendingAction({
        projectId,
        kind: "resume-with-review",
        slashCommand: "/depot-dev FOO",
        humanReadableLabel: "Resume PRD FOO",
      }),
    );
    const second = await run(
      pushPendingAction({
        projectId,
        kind: "resume-with-review",
        slashCommand: "/depot-dev FOO",
        humanReadableLabel: "Resume PRD FOO (duplicate label)",
      }),
    );
    expect(second.id).toBe(first.id);
    const items = await run(listPendingActions(projectId, { status: "pending" }));
    expect(items).toHaveLength(1);
  });

  it("flips a pending action to consumed", async () => {
    const item = await run(
      pushPendingAction({
        projectId,
        kind: "run-ship",
        slashCommand: "/depot-ship X",
        humanReadableLabel: "Ship X",
      }),
    );
    const consumed = await run(consumePendingAction(item.id, "ai"));
    expect(consumed.status).toBe("consumed");
    expect(consumed.consumedBySource).toBe("ai");
  });

  it("dismisses a pending action", async () => {
    const item = await run(
      pushPendingAction({
        projectId,
        kind: "custom",
        slashCommand: "/anything",
        humanReadableLabel: "Anything",
      }),
    );
    const dismissed = await run(dismissPendingAction(item.id));
    expect(dismissed?.status).toBe("dismissed");
  });

  it("auto-dismisses expired pending actions", async () => {
    const item = await run(
      pushPendingAction({
        projectId,
        kind: "custom",
        slashCommand: "/old",
        humanReadableLabel: "Old action",
      }),
    );
    // Backdate createdAt to 30 days ago — direct DB poke so we don't have to
    // wait in test time.
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    db.update(pendingActions).set({ createdAt: old }).where(eq(pendingActions.id, item.id)).run();

    const flipped = await run(autoDismissExpired(projectId, 7));
    expect(flipped).toContain(item.id);
    const stillPending = await run(listPendingActions(projectId, { status: "pending" }));
    expect(stillPending.find((p) => p.id === item.id)).toBeUndefined();
  });
});
