import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { createTestDb, makeRun, resolveMigrationsFolder } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { createPrd, captureMerge, listMerges } from "#/modules/prds/domain";
import { addRepo } from "#/modules/projects/repos";
import { parseMergeRequests } from "#/cli/commands/prds";
import type { Database } from "#/db/client";

async function makeGitRepo(): Promise<{ root: string; sha: string }> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "depot-merge-test-"));
  const realRoot = await fs.realpath(root);
  execFileSync("git", ["init", "-q"], { cwd: realRoot });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: realRoot });
  execFileSync("git", ["config", "user.name", "t"], { cwd: realRoot });
  await fs.writeFile(path.join(realRoot, "f.txt"), "hello");
  execFileSync("git", ["add", "."], { cwd: realRoot });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: realRoot });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: realRoot }).toString().trim();
  return { root: realRoot, sha };
}

describe("parseMergeRequests", () => {
  it("treats no --repo / no --sha as a bare cwd capture", () => {
    const r = parseMergeRequests(undefined, undefined);
    expect(r).toEqual({ ok: true, requests: [{ fromCwd: true }] });
  });

  it("accepts a single --repo <name> --sha <sha>", () => {
    const r = parseMergeRequests("api", "abc123");
    expect(r).toEqual({
      ok: true,
      requests: [{ repoName: "api", sha: "abc123", fromCwd: false }],
    });
  });

  it("accepts multiple --repo name=sha pairs", () => {
    const r = parseMergeRequests(["front=23e5dcb", "api=43db020"], undefined);
    expect(r).toEqual({
      ok: true,
      requests: [
        { repoName: "front", sha: "23e5dcb", fromCwd: false },
        { repoName: "api", sha: "43db020", fromCwd: false },
      ],
    });
  });

  it("refuses a bare --repo without --sha", () => {
    const r = parseMergeRequests("api", undefined);
    expect(r.ok).toBe(false);
  });

  it("refuses multiple bare --repo flags (require name=sha form)", () => {
    const r = parseMergeRequests(["front", "api"], undefined);
    expect(r.ok).toBe(false);
  });

  it("refuses mixing name=sha pairs with a bare --repo name", () => {
    const r = parseMergeRequests(["front=abc", "api"], undefined);
    expect(r.ok).toBe(false);
  });

  it("refuses --sha combined with name=sha pairs", () => {
    const r = parseMergeRequests(["front=abc"], "def");
    expect(r.ok).toBe(false);
  });

  it("refuses an invalid name=sha pair", () => {
    const r = parseMergeRequests(["=abc"], undefined);
    expect(r.ok).toBe(false);
  });
});

describe("captureMerge / listMerges", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  const tempDirs: string[] = [];

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "merge-test" }));
    projectId = project.id;
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("anchors a merge for the implicit mono-repo (repoId null)", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo.root);
    const prd = await run(createPrd({ projectId, title: "Mono PRD" }));

    const merge = await run(
      captureMerge({
        prdRevisionId: prd.id,
        repo: { id: null, name: "(default)", path: repo.root },
        sha: repo.sha,
        capturedFrom: "cwd",
      }),
    );
    expect(merge.repoId).toBeNull();
    expect(merge.repoName).toBe("(default)");
    expect(merge.mergeSha).toBe(repo.sha);
    expect(merge.capturedFrom).toBe("cwd");

    const merges = await run(listMerges(prd.id));
    expect(merges).toHaveLength(1);
    expect(merges[0]?.mergeSha).toBe(repo.sha);
  });

  it("anchors N merges for a multi-repo PRD", async () => {
    const front = await makeGitRepo();
    const api = await makeGitRepo();
    tempDirs.push(front.root, api.root);
    const frontRepo = await run(addRepo({ projectId, name: "front", path: front.root }));
    const apiRepo = await run(addRepo({ projectId, name: "api", path: api.root }));
    const prd = await run(createPrd({ projectId, title: "Multi PRD" }));

    await run(
      captureMerge({
        prdRevisionId: prd.id,
        repo: { id: frontRepo.id, name: "front", path: front.root },
        sha: front.sha,
        capturedFrom: "explicit",
      }),
    );
    await run(
      captureMerge({
        prdRevisionId: prd.id,
        repo: { id: apiRepo.id, name: "api", path: api.root },
        sha: api.sha,
        capturedFrom: "explicit",
      }),
    );

    const merges = await run(listMerges(prd.id));
    expect(merges.map((m) => m.repoName)).toEqual(["api", "front"]);
    expect(merges.find((m) => m.repoName === "api")?.repoId).toBe(apiRepo.id);
  });

  it("upserts on (prdRevisionId, repoName) — re-capture replaces the SHA", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo.root);
    await fs.writeFile(path.join(repo.root, "g.txt"), "second");
    execFileSync("git", ["add", "."], { cwd: repo.root });
    execFileSync("git", ["commit", "-q", "-m", "second"], { cwd: repo.root });
    const secondSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo.root })
      .toString()
      .trim();
    const prd = await run(createPrd({ projectId, title: "Recapture PRD" }));

    await run(
      captureMerge({
        prdRevisionId: prd.id,
        repo: { id: null, name: "(default)", path: repo.root },
        sha: repo.sha,
        capturedFrom: "explicit",
      }),
    );
    await run(
      captureMerge({
        prdRevisionId: prd.id,
        repo: { id: null, name: "(default)", path: repo.root },
        sha: secondSha,
        capturedFrom: "explicit",
      }),
    );

    const merges = await run(listMerges(prd.id));
    expect(merges).toHaveLength(1);
    expect(merges[0]?.mergeSha).toBe(secondSha);
  });

  it("refuses a SHA that does not exist in the repo", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo.root);
    const prd = await run(createPrd({ projectId, title: "Bad SHA PRD" }));

    await expect(
      run(
        captureMerge({
          prdRevisionId: prd.id,
          repo: { id: null, name: "(default)", path: repo.root },
          sha: "0000000000000000000000000000000000000000",
          capturedFrom: "explicit",
        }),
      ),
    ).rejects.toThrow(/does not exist/);
  });
});

describe("prd_merge data migration", () => {
  let dbPath: string;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "depot-migtest-"));
    dbPath = path.join(dir, "test.db");
  });

  afterEach(async () => {
    for (const ext of ["", "-wal", "-shm"]) {
      await fs.rm(dbPath + ext, { force: true });
    }
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("backfills one prd_merge row per legacy merged_at_sha", () => {
    const folder = resolveMigrationsFolder();
    const dirs = readdirSync(folder)
      .filter((d) => existsSync(path.join(folder, d, "migration.sql")))
      .sort();
    const mergeMigration = "20260520150000_prd_merge_anchors";
    const beforeMerge = dirs.filter((d) => d < mergeMigration);

    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON;");

    const applySync = (name: string) => {
      const sql = readFileSync(path.join(folder, name, "migration.sql"), "utf8");
      for (const stmt of sql.split("--> statement-breakpoint")) {
        const t = stmt.trim();
        if (t) db.exec(t);
      }
    };

    for (const d of beforeMerge) applySync(d);

    const now = Date.now();
    db.exec(
      `INSERT INTO projects (id,name,status,created_at,updated_at) VALUES ('mono','Mono','active',${now},${now});`,
    );
    db.exec(
      `INSERT INTO workspaces (id,project_id,path,created_at,updated_at) VALUES ('ws','mono','/tmp/mono-ws',${now},${now});`,
    );
    db.exec(
      `INSERT INTO prds (id,project_id,current_revision_id,created_at,updated_at) VALUES ('p-mono','mono','rev-mono',${now},${now});`,
    );
    db.exec(
      `INSERT INTO prd_revisions (id,prd_id,project_id,workspace_id,revision,title,status,audit_cycles,merged_at_sha,created_at,updated_at) VALUES ('rev-mono','p-mono','mono','ws',1,'Mono','done',0,'monosha',${now},${now});`,
    );

    db.exec(
      `INSERT INTO projects (id,name,status,created_at,updated_at) VALUES ('multi','Multi','active',${now},${now});`,
    );
    db.exec(
      `INSERT INTO prds (id,project_id,current_revision_id,created_at,updated_at) VALUES ('p-multi','multi','rev-multi',${now},${now});`,
    );
    db.exec(
      `INSERT INTO prd_revisions (id,prd_id,project_id,revision,title,status,audit_cycles,merged_at_sha,created_at,updated_at) VALUES ('rev-multi','p-multi','multi',1,'Multi','done',0,'multisha',${now},${now});`,
    );
    db.exec(
      `INSERT INTO project_repo (id,project_id,name,path,is_primary,base_branch,created_at,updated_at) VALUES ('r-front','multi','front','/tmp/front',0,'main',${now},${now});`,
    );
    db.exec(
      `INSERT INTO project_repo (id,project_id,name,path,is_primary,base_branch,created_at,updated_at) VALUES ('r-api','multi','api','/tmp/api',1,'main',${now + 1},${now + 1});`,
    );

    db.exec(
      `INSERT INTO prds (id,project_id,current_revision_id,created_at,updated_at) VALUES ('p-none','mono','rev-none',${now},${now});`,
    );
    db.exec(
      `INSERT INTO prd_revisions (id,prd_id,project_id,revision,title,status,audit_cycles,created_at,updated_at) VALUES ('rev-none','p-none','mono',1,'None','draft',0,${now},${now});`,
    );

    applySync(mergeMigration);

    const rows = db
      .prepare(
        "SELECT prd_revision_id, repo_id, repo_name, repo_path, merge_sha, captured_from FROM prd_merge ORDER BY prd_revision_id",
      )
      .all() as Array<Record<string, unknown>>;
    db.close();

    expect(rows).toHaveLength(2);
    const mono = rows.find((r) => r["prd_revision_id"] === "rev-mono")!;
    expect(mono["repo_id"]).toBeNull();
    expect(mono["repo_name"]).toBe("(default)");
    expect(mono["repo_path"]).toBe("/tmp/mono-ws");
    expect(mono["merge_sha"]).toBe("monosha");
    expect(mono["captured_from"]).toBe("explicit");

    const multi = rows.find((r) => r["prd_revision_id"] === "rev-multi")!;
    expect(multi["repo_id"]).toBe("r-api");
    expect(multi["repo_name"]).toBe("api");
    expect(multi["merge_sha"]).toBe("multisha");
  });
});
