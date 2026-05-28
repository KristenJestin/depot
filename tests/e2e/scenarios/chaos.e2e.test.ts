import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0016 / T3 — Chaos / edge cases.
 *
 * One file, seven independent `it` cases. Each call to `e2eScenario` gets
 * its own tmp dir + tmp DB so the cases are fully isolated and any failure
 * leaves a clean transcript. The cases probe input/path/env/transition
 * robustness — i.e. the classes of bug that historically surface late in
 * production when an exotic user input meets a thin code path.
 *
 *  1. Unicode + quotes in PRD titles round-trip byte-for-byte.
 *  2. Workspace paths with spaces and parentheses work end-to-end.
 *  3. Orphan workspaces are masked by `workspace list` and never resolved.
 *  4. `DEPOT_DB_PATH` beats the legacy `DB_PATH` (only the new file is
 *     written).
 *  5. An invalid lifecycle transition (`prd done` from `draft`) exits
 *     non-zero with an explanatory stderr.
 *  6. `--json` always emits `{kind:"success", payload:{item:{...}}}`.
 *  7. A cwd that points at a file (not a directory) fails cleanly and does
 *     not produce a depot stack trace — the failure happens at process
 *     spawn (ENOTDIR), which is the OS contract we want.
 */

type CreateEnvelope = { item: { id: string } };

const EXOTIC_TITLE = "État de l'art © 2026 → ✓";

describe("e2e chaos / edge cases (PRD 0016 / T3)", () => {
  it("1. preserves unicode + quotes in PRD titles byte-for-byte", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("unicode-titles");
      await ctx.agent.run("depot init unicode-titles", { cwd: repo });

      const created = await ctx.agent.runJson<CreateEnvelope>(
        `depot --json prd create --title "${EXOTIC_TITLE}"`,
        { cwd: repo },
      );
      const prdId = created.item.id;

      const row = ctx.expect.dbRow<{ title: string }>("prd_revisions", { id: prdId });
      if (row.title !== EXOTIC_TITLE) {
        throw new Error(
          `expected DB title to equal '${EXOTIC_TITLE}' byte-for-byte, got '${row.title}'`,
        );
      }

      const show = await ctx.agent.run(`depot prd show ${prdId}`, { cwd: repo });
      ctx.expect.contains(show.stdout, EXOTIC_TITLE);
    }, "1. unicode + quotes in titles");
  });

  it("2. handles workspace paths with spaces and parentheses", async () => {
    await e2eScenario(async (ctx) => {
      const repoPath = await ctx.git.initRepoIn(ctx.root, "my repo (v2)");

      const init = await ctx.agent.run("depot init spaced-app", { cwd: repoPath });
      ctx.expect.exitCode(init, 0);

      const context = await ctx.agent.run("depot context", { cwd: repoPath });
      ctx.expect.exitCode(context, 0);
      ctx.expect.contains(context.stdout, "DEPOT CONTEXT");

      // The workspace must have been registered with a path containing the
      // exotic characters. We can't `dbHas` on the exact string because the
      // path is canonicalised via `realpathSync` and may differ from
      // `repoPath` on macOS (`/private` prefix); read via raw SQLite instead.
      const db = new DatabaseSync(path.join(ctx.root, "depot.db"), { readOnly: true });
      try {
        const rows = db.prepare("SELECT path FROM workspaces").all() as unknown as ReadonlyArray<{
          path: string;
        }>;
        const match = rows.find((r) => r.path.includes("my repo (v2)"));
        if (!match) {
          throw new Error(
            `expected a workspaces.path containing 'my repo (v2)', got: ${JSON.stringify(rows)}`,
          );
        }
      } finally {
        db.close();
      }
    }, "2. spaces + parens in workspace path");
  });

  it("3. masks orphan workspaces in `workspace list` and never resolves them", async () => {
    await e2eScenario(async (ctx) => {
      const mainRepo = await ctx.git.initRepo("orphan-main");
      await ctx.agent.run("depot init orphan-proj", { cwd: mainRepo });

      const wsAPath = await ctx.dir.create("wsA");
      await ctx.agent.run(`depot workspace add --project orphan-proj -p ${wsAPath} --label wsA`, {
        cwd: mainRepo,
      });

      // Sanity: both workspaces visible while wsA still exists on disk.
      const beforeList = await ctx.agent.run("depot workspace list", { cwd: mainRepo });
      ctx.expect.contains(beforeList.stdout, "wsA");

      await rm(wsAPath, { recursive: true, force: true });

      const afterList = await ctx.agent.run("depot workspace list", { cwd: mainRepo });
      ctx.expect.notContains(afterList.stdout, "wsA");
      // The orphan row still lives in the DB — masking is presentation-only.
      ctx.expect.dbHas("workspaces", { label: "wsA" });

      // From an unrelated cwd (the project root, which has its own ws), the
      // orphan must not be resolved. We probe via `log add note --json` which
      // reports the resolved workspace id in `item.workspaceId`.
      const probe = await ctx.agent.runJson<{
        item: { workspaceId: string };
      }>(`depot --json log add note --payload '{"message":"orphan-probe"}'`, { cwd: mainRepo });

      const orphanRow = ctx.expect.dbRow<{ id: string }>("workspaces", { label: "wsA" });
      if (probe.item.workspaceId === orphanRow.id) {
        throw new Error(
          `orphan workspace ${orphanRow.id} was resolved from an unrelated cwd — masking failed`,
        );
      }
    }, "3. orphan workspaces masked");
  });

  it("4. DEPOT_DB_PATH wins over legacy DB_PATH (only the new DB is written)", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("env-precedence");
      const newDb = path.join(ctx.root, "new.db");
      const legacyDb = path.join(ctx.root, "legacy.db");

      const result = await ctx.agent.run("depot init precedence-proj", {
        cwd: repo,
        env: { DEPOT_DB_PATH: newDb, DB_PATH: legacyDb },
      });
      ctx.expect.exitCode(result, 0);

      if (!existsSync(newDb)) {
        throw new Error(`expected ${newDb} to be created, but it does not exist`);
      }
      if (existsSync(legacyDb)) {
        throw new Error(
          `expected ${legacyDb} to remain untouched, but it was created — DEPOT_DB_PATH did not win`,
        );
      }

      // Inspect the new DB directly: it must contain the project row.
      const db = new DatabaseSync(newDb, { readOnly: true });
      try {
        const row = db
          .prepare("SELECT id, name FROM projects WHERE name = ?")
          .get("precedence-proj") as { id: string; name: string } | undefined;
        if (!row) {
          throw new Error(`expected projects.name='precedence-proj' in ${newDb}, got no row`);
        }
      } finally {
        db.close();
      }
    }, "4. DEPOT_DB_PATH precedence over DB_PATH");
  });

  it("5. rejects an invalid PRD transition (`done` from `draft`) with an explanatory error", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("invalid-transition");
      await ctx.agent.run("depot init invalid-proj", { cwd: repo });

      const created = await ctx.agent.runJson<CreateEnvelope>(
        "depot --json prd create --title 'Transition test PRD'",
        { cwd: repo },
      );
      const prdId = created.item.id;

      const result = await ctx.agent.run(`depot prd done ${prdId} --user-confirmed 'try this'`, {
        cwd: repo,
        expectExit: "any",
      });
      if (result.exitCode === 0) {
        throw new Error(`expected non-zero exit for invalid transition, got 0`);
      }
      ctx.expect.contains(result.stderr, "Invalid PRD transition");
      ctx.expect.contains(result.stderr, "draft");

      // The PRD must still be in `draft` — a failed transition must not
      // mutate state.
      const row = ctx.expect.dbRow<{ status: string }>("prd_revisions", { id: prdId });
      if (row.status !== "draft") {
        throw new Error(`expected status=draft after rejected transition, got '${row.status}'`);
      }
    }, "5. invalid PRD transition");
  });

  it("6. `--json` envelope is consistent across create and show", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("json-envelope");
      await ctx.agent.run("depot init json-proj", { cwd: repo });

      const createResult = await ctx.agent.run(
        "depot --json prd create --title 'JSON envelope PRD'",
        { cwd: repo },
      );
      ctx.expect.exitCode(createResult, 0);
      ctx.expect.contains(createResult.stdout, '"kind":"success"');
      ctx.expect.contains(createResult.stdout, '"payload":');

      const createParsed = JSON.parse(createResult.stdout) as {
        kind: string;
        payload: { item: { id: string } };
      };
      if (createParsed.kind !== "success") {
        throw new Error(`expected kind="success" in create envelope, got '${createParsed.kind}'`);
      }
      if (!createParsed.payload?.item?.id) {
        throw new Error(
          `expected payload.item.id in create envelope, got ${JSON.stringify(createParsed)}`,
        );
      }
      const prdId = createParsed.payload.item.id;

      const showResult = await ctx.agent.run(`depot --json prd show ${prdId}`, { cwd: repo });
      ctx.expect.exitCode(showResult, 0);
      ctx.expect.contains(showResult.stdout, '"kind":"success"');

      const showParsed = JSON.parse(showResult.stdout) as {
        kind: string;
        payload: { item: { id: string } };
      };
      if (showParsed.kind !== "success") {
        throw new Error(`expected kind="success" in show envelope, got '${showParsed.kind}'`);
      }
      if (showParsed.payload?.item?.id !== prdId) {
        throw new Error(
          `expected payload.item.id=${prdId} in show envelope, got ${JSON.stringify(showParsed)}`,
        );
      }
    }, "6. JSON envelope consistency");
  });

  it("7. fails cleanly when cwd is a file instead of a directory", async () => {
    await e2eScenario(async (ctx) => {
      const filePath = path.join(ctx.root, "notadir.txt");
      await writeFile(filePath, "this is a regular file\n", "utf-8");

      // `child_process.spawn` rejects synchronously when its `cwd` option
      // points at a regular file — no depot code runs, so there is no node
      // crash or cryptic stack trace from the CLI itself. POSIX reports
      // ENOTDIR; Windows reports ENOENT for this spawn shape. Both are
      // acceptable as long as the failure names the OS-level syscall error.
      let caught: Error | null = null;
      try {
        await ctx.agent.run("depot context", { cwd: filePath, expectExit: "any" });
      } catch (e) {
        caught = e instanceof Error ? e : new Error(String(e));
      }
      if (!caught) {
        throw new Error(`expected agent.run to reject when cwd is a file, but it resolved`);
      }
      if (!caught.message.includes("ENOTDIR") && !caught.message.includes("ENOENT")) {
        ctx.expect.contains(caught.message, "ENOTDIR or ENOENT");
      }
    }, "7. cwd that is a file");
  });
});
