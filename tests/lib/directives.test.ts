import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTestDb, makeRun } from "../helpers/db";
import {
  createDirective,
  listDirectives,
  updateDirective,
  removeDirective,
  runDirective,
  runScopeBlocking,
  runScopeBlockingForPrd,
  reorderDirectives,
} from "#/modules/projects/directives";
import { createProject } from "#/modules/projects/domain";
import { addRepo } from "#/modules/projects/repos";
import { listActivity } from "#/modules/activity/domain";
import { formatSelectionTrace } from "#/modules/projects/directives";
import { createPrd } from "#/modules/prds/domain";
import { addPrdRepo } from "#/modules/prds/repos";
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
        category: "dev",
        kind: "command",
        title: "Format",
        instruction: "echo format",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-ship",
        category: "ship",
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
          category: "dev",
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
        category: "dev",
        kind: "command",
        title: "Lint",
        instruction: "echo lint",
      }),
    );
    const updated = await run(updateDirective(d.id, { enabled: false, title: "Lint (disabled)" }));
    expect(updated.enabled).toBe(false);
    expect(updated.title).toBe("Lint (disabled)");
  });

  it("updateDirective patches category and re-validates (category, scope) (PRD 0017 / T5)", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "rule",
        title: "auditor-bound",
        instruction: "ok",
      }),
    );
    const updated = await run(updateDirective(d.id, { category: "auditor" }));
    expect(updated.category).toBe("auditor");
    expect(updated.scope).toBe("pre-review");
  });

  it("updateDirective rejects an invalid resulting (category, scope) pair (PRD 0017 / T5)", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "rule",
        title: "cannot move to doc/pre-review",
        instruction: "ok",
      }),
    );
    await expect(run(updateDirective(d.id, { category: "doc" }))).rejects.toThrow(
      /invalid \(category, scope\)/i,
    );
    // Validate the table is preserved (no partial write).
    const after = (await run(listDirectives(projectId))).find((row) => row.id === d.id);
    expect(after?.category).toBe("dev");
  });

  it("updateDirective rejects an unknown category value (PRD 0017 / T5)", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "always",
        category: "dev",
        kind: "rule",
        title: "ok",
        instruction: "ok",
      }),
    );
    await expect(
      run(updateDirective(d.id, { category: "frontend" as unknown as "dev" })),
    ).rejects.toThrow(/unknown directive category/i);
  });

  it("removes a directive", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
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
        category: "dev",
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
        category: "dev",
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
        category: "dev",
        kind: "command",
        title: "A - ok",
        instruction: "echo a",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "B - fails",
        instruction: "exit 3",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
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

  it("defaults repoTarget to auto", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Format",
        instruction: "echo format",
      }),
    );
    expect(d.repoTarget).toBe("auto");
    const explicit = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "API only",
        instruction: "echo api",
        repoTarget: "api",
      }),
    );
    expect(explicit.repoTarget).toBe("api");
  });

  it("reorders directives by position", async () => {
    const a = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "A",
        instruction: "echo a",
      }),
    );
    const b = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
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

describe("createDirective category validation (PRD 0013 / T1)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "test" }))).id;
  });

  it("rejects when category is missing", async () => {
    await expect(
      run(
        createDirective({
          projectId,
          scope: "always",
          kind: "rule",
          title: "no cat",
          instruction: "be polite",
        }),
      ),
    ).rejects.toThrow(/category is required/i);
  });

  it("rejects when (category, scope) is not in the validity table", async () => {
    await expect(
      run(
        createDirective({
          projectId,
          scope: "pre-doc-sync",
          category: "dev",
          kind: "rule",
          title: "wrong combo",
          instruction: "noop",
        }),
      ),
    ).rejects.toThrow(/invalid \(category, scope\)/i);

    await expect(
      run(
        createDirective({
          projectId,
          scope: "pre-commit",
          category: "prd",
          kind: "rule",
          title: "wrong combo",
          instruction: "noop",
        }),
      ),
    ).rejects.toThrow(/invalid \(category, scope\)/i);

    await expect(
      run(
        createDirective({
          projectId,
          scope: "pre-ship",
          category: "doc",
          kind: "rule",
          title: "wrong combo",
          instruction: "noop",
        }),
      ),
    ).rejects.toThrow(/invalid \(category, scope\)/i);
  });

  it("accepts every (category, scope) pair declared valid by the spec", async () => {
    const valid: Array<{
      category: "prd" | "dev" | "coder" | "auditor" | "doc" | "ship";
      scope:
        | "always"
        | "pre-review"
        | "pre-commit"
        | "pre-doc-sync"
        | "pre-ship"
        | "on-error"
        | "pre-coder-spawn"
        | "post-auditor-pass"
        | "pre-handoff"
        | "pre-phase-advance";
    }> = [
      { category: "prd", scope: "always" },
      { category: "dev", scope: "always" },
      { category: "dev", scope: "pre-coder-spawn" },
      { category: "dev", scope: "pre-review" },
      { category: "dev", scope: "post-auditor-pass" },
      { category: "dev", scope: "pre-handoff" },
      { category: "dev", scope: "pre-phase-advance" },
      { category: "coder", scope: "always" },
      { category: "coder", scope: "pre-commit" },
      { category: "auditor", scope: "always" },
      { category: "auditor", scope: "pre-review" },
      { category: "doc", scope: "always" },
      { category: "doc", scope: "pre-doc-sync" },
      { category: "ship", scope: "always" },
      { category: "ship", scope: "pre-ship" },
    ];
    expect(valid).toHaveLength(15);
    for (const pair of valid) {
      const created = await run(
        createDirective({
          projectId,
          scope: pair.scope,
          category: pair.category,
          kind: "rule",
          title: `${pair.category}/${pair.scope}`,
          instruction: "ok",
        }),
      );
      expect(created.category).toBe(pair.category);
      expect(created.scope).toBe(pair.scope);
    }
    const all = await run(listDirectives(projectId));
    expect(all).toHaveLength(15);
  });

  it("rejects an unknown category value", async () => {
    await expect(
      run(
        createDirective({
          projectId,
          scope: "always",
          // unknown category casted in — runtime guard must still trip.
          category: "frontend" as unknown as "dev",
          kind: "rule",
          title: "bad cat",
          instruction: "noop",
        }),
      ),
    ).rejects.toThrow(/unknown directive category/i);
  });
});

describe("listDirectives category filter (PRD 0013 / T1)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "test" }))).id;
    await run(
      createDirective({
        projectId,
        scope: "always",
        category: "dev",
        kind: "rule",
        title: "dev always",
        instruction: "ok",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "always",
        category: "coder",
        kind: "rule",
        title: "coder always",
        instruction: "ok",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-commit",
        category: "coder",
        kind: "rule",
        title: "coder pre-commit",
        instruction: "ok",
      }),
    );
  });

  it("returns every row when no filter is provided (backward-compat)", async () => {
    const rows = await run(listDirectives(projectId));
    expect(rows).toHaveLength(3);
  });

  it("filters by category alone", async () => {
    const rows = await run(listDirectives(projectId, { category: "coder" }));
    expect(rows.map((r) => r.title).sort()).toEqual(["coder always", "coder pre-commit"]);
  });

  it("filters by scope alone (existing behaviour intact)", async () => {
    const rows = await run(listDirectives(projectId, { scope: "always" }));
    expect(rows.map((r) => r.title).sort()).toEqual(["coder always", "dev always"]);
  });

  it("combines category and scope filters", async () => {
    const rows = await run(listDirectives(projectId, { category: "coder", scope: "pre-commit" }));
    expect(rows.map((r) => r.title)).toEqual(["coder pre-commit"]);
  });
});

describe("project_directives.category backfill migration (PRD 0013 / T1)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "test" }))).id;
  });

  it("backfills category from scope for every legacy scope", async () => {
    const cases: Array<{ scope: string; expected: string }> = [
      { scope: "pre-doc-sync", expected: "doc" },
      { scope: "pre-ship", expected: "ship" },
      { scope: "pre-commit", expected: "coder" },
      { scope: "pre-review", expected: "dev" },
      { scope: "always", expected: "dev" },
      { scope: "on-error", expected: "dev" },
    ];
    const sqliteClient = (
      db as unknown as {
        $client: {
          prepare: (sql: string) => {
            run: (...args: unknown[]) => void;
            all: (...args: unknown[]) => unknown[];
          };
        };
      }
    ).$client;
    // Simulate pre-migration rows: each is inserted with NULL `category`, just
    // like a row that existed before the ALTER TABLE landed.
    for (const c of cases) {
      sqliteClient
        .prepare(
          "INSERT INTO project_directives (id, project_id, scope, category, title, instruction, kind, repo_target, blocking, position, enabled, created_at, updated_at) " +
            "VALUES (?, ?, ?, NULL, ?, ?, 'rule', 'auto', 1, 0, 1, ?, ?)",
        )
        .run(`leg-${c.scope}`, projectId, c.scope, `legacy ${c.scope}`, "noop", 0, 0);
    }
    // Re-run the backfill statement from the migration — drizzle's migrator
    // has already applied it once on the in-memory DB, but applying it again
    // is idempotent because of the `WHERE category IS NULL` clause.
    sqliteClient
      .prepare(
        "UPDATE project_directives SET category = CASE scope " +
          "WHEN 'pre-doc-sync' THEN 'doc' " +
          "WHEN 'pre-ship'     THEN 'ship' " +
          "WHEN 'pre-commit'   THEN 'coder' " +
          "WHEN 'pre-review'   THEN 'dev' " +
          "WHEN 'always'       THEN 'dev' " +
          "WHEN 'on-error'     THEN 'dev' " +
          "ELSE 'dev' END WHERE category IS NULL",
      )
      .run();
    const rows = sqliteClient
      .prepare("SELECT scope, category FROM project_directives ORDER BY scope")
      .all() as Array<{ scope: string; category: string }>;
    expect(rows).toHaveLength(cases.length);
    const byScope = new Map(rows.map((r) => [r.scope, r.category]));
    for (const c of cases) {
      expect(byScope.get(c.scope)).toBe(c.expected);
    }
  });
});

describe("formatSelectionTrace", () => {
  it("returns null for the single-repo / mono-repo case (no extra noise)", () => {
    expect(
      formatSelectionTrace({ reason: "single-repo", repos: [{ name: "(default)", path: "/x" }] }),
    ).toBeNull();
  });

  it("lists the dirty repos and the considered-vs-matched ratio for auto-dirty", () => {
    const trace = formatSelectionTrace({
      reason: "auto-dirty",
      repos: [
        { name: "api", path: "/a" },
        { name: "front", path: "/f" },
      ],
      consideredRepos: [
        { name: "api", path: "/a" },
        { name: "front", path: "/f" },
        { name: "docs", path: "/d" },
      ],
    });
    expect(trace).toContain("api");
    expect(trace).toContain("front");
    expect(trace).toContain("2/3");
    expect(trace).toContain("uncommitted");
  });

  it("explains auto-no-dirty as the empty selection it is", () => {
    const trace = formatSelectionTrace({
      reason: "auto-no-dirty",
      repos: [],
      consideredRepos: [
        { name: "api", path: "/a" },
        { name: "front", path: "/f" },
      ],
    });
    expect(trace).toContain("none");
    expect(trace).toContain("0/2");
  });

  it("labels explicit `all` selections", () => {
    const trace = formatSelectionTrace({
      reason: "all",
      repos: [
        { name: "api", path: "/a" },
        { name: "front", path: "/f" },
      ],
    });
    expect(trace).toContain("api, front");
    expect(trace).toContain("all");
  });
});

describe("repo-aware directives", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  const tempDirs: string[] = [];

  async function makeGitRepo(dirty: boolean): Promise<string> {
    const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-dir-repo-")));
    tempDirs.push(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: root });
    execFileSync("git", ["config", "user.name", "t"], { cwd: root });
    await fs.writeFile(path.join(root, "f.txt"), "hello");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
    if (dirty) await fs.writeFile(path.join(root, "f.txt"), "changed");
    return root;
  }

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("repoTarget: auto runs only in modified repos", async () => {
    const apiRepo = await makeGitRepo(true);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo cwd",
        instruction: "echo cwd",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.repoResults).toHaveLength(1);
    expect(result.repoResults[0]?.repoName).toBe("api");
  });

  it("repoTarget: auto is a no-op when no repo is modified", async () => {
    const apiRepo = await makeGitRepo(false);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Should fail if run",
        instruction: "exit 1",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.noOp).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.repoResults).toHaveLength(0);
  });

  it("repoTarget: all runs in every registered repo", async () => {
    const apiRepo = await makeGitRepo(false);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "all",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.repoResults.map((r) => r.repoName).sort()).toEqual(["api", "front"]);
  });

  it("repoTarget: <name> runs only in the named repo", async () => {
    const apiRepo = await makeGitRepo(false);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "front",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.repoResults).toHaveLength(1);
    expect(result.repoResults[0]?.repoName).toBe("front");
  });

  it("mono-repo project runs auto in the implicit repo", async () => {
    const repo = await makeGitRepo(false);
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: repo }));
    expect(result.ok).toBe(true);
    expect(result.repoResults).toHaveLength(1);
    expect(result.noOp).toBe(false);
  });

  it("repoTarget: auto exposes selection (repos + reason) for N dirty repos", async () => {
    const apiRepo = await makeGitRepo(true);
    const frontRepo = await makeGitRepo(true);
    const docsRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    await run(addRepo({ projectId, name: "docs", path: docsRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.selection.reason).toBe("auto-dirty");
    expect(result.selection.repos.map((r) => r.name).sort()).toEqual(["api", "front"]);
    expect(result.selection.consideredRepos?.map((r) => r.name).sort()).toEqual([
      "api",
      "docs",
      "front",
    ]);
  });

  it("repoTarget: auto with single dirty repo (multi-repo project) still traces selection", async () => {
    const apiRepo = await makeGitRepo(true);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.selection.reason).toBe("auto-dirty");
    expect(result.selection.repos.map((r) => r.name)).toEqual(["api"]);
    expect(result.selection.consideredRepos?.map((r) => r.name).sort()).toEqual(["api", "front"]);
  });

  it("mono-repo project: selection reason is `single-repo` (minimal trace)", async () => {
    const repo = await makeGitRepo(true);
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: repo }));
    expect(result.selection.reason).toBe("single-repo");
    expect(result.selection.repos).toHaveLength(1);
    expect(result.selection.consideredRepos).toBeUndefined();
  });

  it("repoTarget: auto with no dirty repo exposes empty selection + reason", async () => {
    const apiRepo = await makeGitRepo(false);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.selection.reason).toBe("auto-no-dirty");
    expect(result.selection.repos).toEqual([]);
    expect(result.selection.consideredRepos?.map((r) => r.name).sort()).toEqual(["api", "front"]);
  });

  it("records a directive_run activity entry with the selection payload", async () => {
    const apiRepo = await makeGitRepo(true);
    const frontRepo = await makeGitRepo(true);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    await run(runDirective(d.id, { wsPath: apiRepo }));
    const entries = await run(listActivity({ projectId }));
    const runEntry = entries.find((e) => e.eventType === "directive_run");
    expect(runEntry).toBeTruthy();
    const payload = JSON.parse(runEntry!.payload) as {
      directiveId: string;
      status: string;
      repoTarget: string;
      selection: { reason: string; repos: Array<{ name: string }> };
    };
    expect(payload.directiveId).toBe(d.id);
    expect(payload.status).toBe("ok");
    expect(payload.repoTarget).toBe("auto");
    expect(payload.selection.reason).toBe("auto-dirty");
    expect(payload.selection.repos.map((r) => r.name).sort()).toEqual(["api", "front"]);
  });

  it("mono-repo: directive_run log carries the minimal selection (single-repo)", async () => {
    const repo = await makeGitRepo(false);
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    await run(runDirective(d.id, { wsPath: repo }));
    const entries = await run(listActivity({ projectId }));
    const runEntry = entries.find((e) => e.eventType === "directive_run");
    expect(runEntry).toBeTruthy();
    const payload = JSON.parse(runEntry!.payload) as {
      selection: { reason: string; repos: unknown[] };
    };
    expect(payload.selection.reason).toBe("single-repo");
    expect(payload.selection.repos).toHaveLength(1);
  });
});

describe("runDirective — PRD-scoped activity log (PRD 0007 T2)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  const multiRepoTempDirs: string[] = [];

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "test" }))).id;
  });

  afterEach(async () => {
    for (const dir of multiRepoTempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("attaches prd_revision_id to the directive_run log line when prdRevisionId is passed", async () => {
    const prd = await run(createPrd({ projectId, title: "feature" }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
      }),
    );
    await run(runDirective(d.id, { wsPath: process.cwd(), prdRevisionId: prd.id }));
    const entries = await run(listActivity({ projectId }));
    const runEntry = entries.find((e) => e.eventType === "directive_run");
    expect(runEntry).toBeTruthy();
    expect(runEntry!.prdRevisionId).toBe(prd.id);
  });

  it("leaves prd_revision_id null when prdRevisionId is omitted", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
      }),
    );
    await run(runDirective(d.id, { wsPath: process.cwd() }));
    const entries = await run(listActivity({ projectId }));
    const runEntry = entries.find((e) => e.eventType === "directive_run");
    expect(runEntry).toBeTruthy();
    expect(runEntry!.prdRevisionId).toBeNull();
  });

  it("runScopeBlockingForPrd iterates the PRD's prd_repo with workspace target", async () => {
    const apiRepo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    const frontRepo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    multiRepoTempDirs.push(apiRepo, frontRepo);
    const api = await run(addRepo({ projectId, name: "api", path: apiRepo }));
    const front = await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const prd = await run(createPrd({ projectId, title: "feature" }));
    await run(addPrdRepo(prd.id, api.id));
    await run(addPrdRepo(prd.id, front.id));
    await run(
      createDirective({
        projectId,
        scope: "pre-ship",
        category: "ship",
        kind: "command",
        title: "Print cwd",
        instruction: "echo cwd",
        repoTarget: "workspace",
      }),
    );
    const result = await run(runScopeBlockingForPrd(prd.id, "pre-ship", { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.perRepo.map((r) => r.repoName).sort()).toEqual(["api", "front"]);
    // Both repo iterations succeeded.
    for (const repoOutcome of result.perRepo) {
      expect(repoOutcome.ok).toBe(true);
      expect(repoOutcome.results).toHaveLength(1);
    }
    // Each iteration produced a directive_run log line attributed to the PRD.
    const entries = await run(listActivity({ projectId }));
    const runEntries = entries.filter((e) => e.eventType === "directive_run");
    expect(runEntries).toHaveLength(2);
    for (const entry of runEntries) {
      expect(entry.prdRevisionId).toBe(prd.id);
    }
  });

  it("runScopeBlockingForPrd falls back to project_repo when prd_repo is empty", async () => {
    const apiRepo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    const frontRepo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    multiRepoTempDirs.push(apiRepo, frontRepo);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const prd = await run(createPrd({ projectId, title: "feature" }));
    // Intentionally no `prd_repo` rows — fallback should iterate all project_repos.
    await run(
      createDirective({
        projectId,
        scope: "pre-ship",
        category: "ship",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "workspace",
      }),
    );
    const result = await run(runScopeBlockingForPrd(prd.id, "pre-ship", { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.perRepo.map((r) => r.repoName).sort()).toEqual(["api", "front"]);
  });

  it("runScopeBlockingForPrd in mono-repo runs once against the implicit repo", async () => {
    const repo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    multiRepoTempDirs.push(repo);
    const prd = await run(createPrd({ projectId, title: "feature" }));
    await run(
      createDirective({
        projectId,
        scope: "pre-ship",
        category: "ship",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "workspace",
      }),
    );
    const result = await run(runScopeBlockingForPrd(prd.id, "pre-ship", { wsPath: repo }));
    expect(result.ok).toBe(true);
    expect(result.perRepo).toHaveLength(1);
    expect(result.perRepo[0]?.results).toHaveLength(1);
  });

  it("runScopeBlocking propagates prdRevisionId to each directive_run log line", async () => {
    const prd = await run(createPrd({ projectId, title: "feature" }));
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "A",
        instruction: "echo a",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        category: "dev",
        kind: "command",
        title: "B",
        instruction: "echo b",
      }),
    );
    await run(
      runScopeBlocking(projectId, "pre-review", {
        wsPath: process.cwd(),
        prdRevisionId: prd.id,
      }),
    );
    const entries = await run(listActivity({ projectId }));
    const runEntries = entries.filter((e) => e.eventType === "directive_run");
    expect(runEntries).toHaveLength(2);
    for (const entry of runEntries) {
      expect(entry.prdRevisionId).toBe(prd.id);
    }
  });
});
