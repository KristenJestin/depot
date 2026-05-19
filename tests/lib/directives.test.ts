import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, makeRun } from "../helpers/db";
import {
  createDirective,
  listDirectives,
  updateDirective,
  removeDirective,
  runDirective,
  runScopeBlocking,
  reorderDirectives,
} from "#/modules/projects/directives";
import { createProject } from "#/modules/projects/domain";
import type { Database } from "#/db/client";

describe("project directives", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
  });

  it("creates and lists directives by scope", async () => {
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Format",
        instruction: "echo format",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-ship",
        kind: "rule",
        title: "Update CHANGELOG",
        instruction: "always update CHANGELOG before ship",
      }),
    );
    const preReview = await run(listDirectives(projectId, { scope: "pre-review" }));
    expect(preReview).toHaveLength(1);
    expect(preReview[0]?.title).toBe("Format");
    const preShip = await run(listDirectives(projectId, { scope: "pre-ship" }));
    expect(preShip).toHaveLength(1);
    expect(preShip[0]?.kind).toBe("rule");
  });

  it("refuses dangerous shell patterns", async () => {
    await expect(
      run(
        createDirective({
          projectId,
          scope: "pre-review",
          kind: "command",
          title: "Bad",
          instruction: "rm -rf /tmp/foo",
        }),
      ),
    ).rejects.toThrow(/dangerous pattern/);
  });

  it("updates a directive", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Lint",
        instruction: "echo lint",
      }),
    );
    const updated = await run(updateDirective(d.id, { enabled: false, title: "Lint (disabled)" }));
    expect(updated.enabled).toBe(false);
    expect(updated.title).toBe("Lint (disabled)");
  });

  it("removes a directive", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Tmp",
        instruction: "echo tmp",
      }),
    );
    await run(removeDirective(d.id));
    const remaining = await run(listDirectives(projectId));
    expect(remaining).toHaveLength(0);
  });

  it("runs a command directive and records last run status", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo success",
        instruction: "echo hello",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: process.cwd() }));
    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("hello");
    const after = (await run(listDirectives(projectId)))[0]!;
    expect(after.lastRunStatus).toBe("ok");
  });

  it("captures failure exit codes", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Fails",
        instruction: "exit 7",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: process.cwd() }));
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
  });

  it("runScopeBlocking stops at first failure", async () => {
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "A - ok",
        instruction: "echo a",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "B - fails",
        instruction: "exit 3",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "C - never runs",
        instruction: "echo c",
      }),
    );
    const result = await run(runScopeBlocking(projectId, "pre-review", { wsPath: process.cwd() }));
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[1]?.ok).toBe(false);
    expect(result.failingDirectiveId).toBeTruthy();
  });

  it("reorders directives by position", async () => {
    const a = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "A",
        instruction: "echo a",
      }),
    );
    const b = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "B",
        instruction: "echo b",
      }),
    );
    await run(reorderDirectives(projectId, "pre-review", [b.id, a.id]));
    const list = await run(listDirectives(projectId, { scope: "pre-review" }));
    expect(list.map((d) => d.title)).toEqual(["B", "A"]);
  });
});
