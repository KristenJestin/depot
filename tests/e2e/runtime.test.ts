import { describe, it, expect } from "vite-plus/test";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDirHelper } from "./runtime/dir";
import { createGitHelper } from "./runtime/git";
import { createAgentHelper } from "./runtime/agent";
import { createExpectHelper } from "./runtime/expect";

/**
 * Unit tests for the E2E runtime itself. Kept under `tests/e2e/runtime.test.ts`
 * (NOT `.e2e.test.ts`) so they run as part of the standard `bun run test`
 * loop without needing the packed CLI. We exercise each helper against the
 * lightest possible shell command (`node -e`) instead of `depot`, so a
 * regression in the CLI cannot mask a regression in the runtime.
 */

const execFileAsync = promisify(execFile);

async function setupScenario() {
  const handle = await createDirHelper();
  return { handle, dir: handle.helper };
}

describe("e2e runtime — dir", () => {
  it("create() returns an existing absolute path inside the root", async () => {
    const { handle, dir } = await setupScenario();
    try {
      const sub = await dir.create("hello");
      expect(path.isAbsolute(sub)).toBe(true);
      expect(sub.startsWith(dir.root)).toBe(true);
      expect(existsSync(sub)).toBe(true);
      expect(statSync(sub).isDirectory()).toBe(true);
    } finally {
      await handle.cleanup();
    }
  });

  it("cleanup() removes the root", async () => {
    const { handle, dir } = await setupScenario();
    await dir.create("x");
    expect(existsSync(dir.root)).toBe(true);
    await handle.cleanup();
    expect(existsSync(dir.root)).toBe(false);
  });
});

describe("e2e runtime — git", () => {
  it("initRepo() produces a valid git repo with an initial commit", async () => {
    const { handle, dir } = await setupScenario();
    try {
      const git = createGitHelper(dir);
      const repo = await git.initRepo("main-repo");
      expect(existsSync(path.join(repo, ".git"))).toBe(true);
      const { stdout: head } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repo });
      expect(head.trim()).toMatch(/^[0-9a-f]{40}$/);
      const { stdout: log } = await execFileAsync("git", ["log", "--oneline"], { cwd: repo });
      expect(log).toContain("initial commit");
    } finally {
      await handle.cleanup();
    }
  });

  it("worktreeAdd() creates a sibling worktree with a .git file pointing at the common dir", async () => {
    const { handle, dir } = await setupScenario();
    try {
      const git = createGitHelper(dir);
      const repo = await git.initRepo("origin");
      const wtPath = path.join(path.dirname(repo), "wt-feature");
      await git.worktreeAdd(repo, wtPath, "feature/x");
      expect(existsSync(wtPath)).toBe(true);
      const gitMarker = path.join(wtPath, ".git");
      expect(existsSync(gitMarker)).toBe(true);
      expect(statSync(gitMarker).isFile()).toBe(true);
      const gitFileBody = await readFile(gitMarker, "utf-8");
      expect(gitFileBody.startsWith("gitdir: ")).toBe(true);
      const { stdout: commonDir } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], {
        cwd: wtPath,
      });
      expect(commonDir.trim()).toContain(path.basename(repo));
    } finally {
      await handle.cleanup();
    }
  });

  it("commit() writes files and records them", async () => {
    const { handle, dir } = await setupScenario();
    try {
      const git = createGitHelper(dir);
      const repo = await git.initRepo("commit-test");
      await git.commit(repo, { "nested/file.txt": "hello\n" }, "add nested file");
      const { stdout } = await execFileAsync("git", ["log", "--oneline"], { cwd: repo });
      expect(stdout).toContain("add nested file");
      expect(existsSync(path.join(repo, "nested/file.txt"))).toBe(true);
    } finally {
      await handle.cleanup();
    }
  });
});

describe("e2e runtime — agent", () => {
  it("run() propagates exit code 0 and stdout for a simple shell command", async () => {
    const { handle, dir } = await setupScenario();
    try {
      const cwd = await dir.create("agent-cwd");
      const agent = await createAgentHelper({ scenarioRoot: dir.root, initialCwd: cwd });
      const result = await agent.run('node -e "process.stdout.write(\\"hello\\")"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello");
      expect(typeof result.durationMs).toBe("number");
    } finally {
      await handle.cleanup();
    }
  });

  it("run() throws on unexpected non-zero exit when expectExit defaults to 0", async () => {
    const { handle, dir } = await setupScenario();
    try {
      const cwd = await dir.create("agent-cwd");
      const agent = await createAgentHelper({ scenarioRoot: dir.root, initialCwd: cwd });
      let threw = false;
      try {
        await agent.run('node -e "process.exit(3)"');
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      await handle.cleanup();
    }
  });

  it("run() with expectExit: 'any' tolerates non-zero exits and propagates the code", async () => {
    const { handle, dir } = await setupScenario();
    try {
      const cwd = await dir.create("agent-cwd");
      const agent = await createAgentHelper({ scenarioRoot: dir.root, initialCwd: cwd });
      const result = await agent.run('node -e "process.stderr.write(\\"boom\\");process.exit(7)"', {
        expectExit: "any",
      });
      expect(result.exitCode).toBe(7);
      expect(result.stderr).toBe("boom");
    } finally {
      await handle.cleanup();
    }
  });

  it("cd() changes the default cwd for subsequent run() calls", async () => {
    const { handle, dir } = await setupScenario();
    try {
      const cwd1 = await dir.create("first");
      const cwd2 = await dir.create("second");
      const agent = await createAgentHelper({ scenarioRoot: dir.root, initialCwd: cwd1 });
      agent.cd(cwd2);
      const result = await agent.run('node -e "process.stdout.write(process.cwd())"');
      expect(result.stdout).toBe(cwd2);
    } finally {
      await handle.cleanup();
    }
  });

  it("spawn() starts a background process, exposes its pid, and kill() stops it", async () => {
    const { handle, dir } = await setupScenario();
    const cleanups: Array<() => Promise<void> | void> = [];
    try {
      const cwd = await dir.create("agent-cwd");
      const agent = await createAgentHelper({
        scenarioRoot: dir.root,
        initialCwd: cwd,
        registerCleanup: (fn) => cleanups.push(fn),
      });
      // Sleep long enough that the test always sees the process alive, and
      // short enough that a failed kill still terminates the run quickly.
      const sub = agent.spawn('node -e "setTimeout(() => {}, 60000)"');
      expect(typeof sub.pid).toBe("number");
      expect(sub.pid).toBeGreaterThan(0);

      // The OS reports the process exists by `kill(0)` returning without
      // throwing (POSIX). On Linux/macOS this is the canonical liveness probe.
      expect(() => process.kill(sub.pid, 0)).not.toThrow();

      sub.kill();
      // Give the child a moment to actually exit before asserting it's gone.
      await new Promise<void>((r) => setTimeout(r, 200));
      let stillAlive = true;
      try {
        process.kill(sub.pid, 0);
      } catch {
        stillAlive = false;
      }
      expect(stillAlive).toBe(false);
    } finally {
      for (const fn of cleanups) await fn();
      await handle.cleanup();
    }
  });

  it("spawn().waitForPort() resolves once a TCP listener accepts on that port", async () => {
    const { handle, dir } = await setupScenario();
    const cleanups: Array<() => Promise<void> | void> = [];
    // Pick a free port up front by binding ephemerally, then closing.
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.unref();
      probe.on("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const addr = probe.address();
        if (addr && typeof addr === "object") {
          const p = addr.port;
          probe.close(() => resolve(p));
        } else {
          probe.close(() => reject(new Error("could not allocate port")));
        }
      });
    });

    try {
      const cwd = await dir.create("agent-cwd");
      const agent = await createAgentHelper({
        scenarioRoot: dir.root,
        initialCwd: cwd,
        registerCleanup: (fn) => cleanups.push(fn),
      });
      // Tiny inline TCP server that begins listening after a short delay so we
      // exercise the retry loop, not the happy-first-shot path.
      const script = `setTimeout(() => { const s = require('node:net').createServer(); s.listen(${port}, '127.0.0.1'); }, 200);`;
      const sub = agent.spawn(`node -e ${JSON.stringify(script)}`);
      let resolved = false;
      try {
        await sub.waitForPort(port, 5000);
        resolved = true;
      } finally {
        sub.kill();
      }
      expect(resolved).toBe(true);
    } finally {
      for (const fn of cleanups) await fn();
      await handle.cleanup();
    }
  });
});

describe("e2e runtime — expect", () => {
  it("dbHas() succeeds on a matching row and throws on a missing one", async () => {
    const { handle, dir } = await setupScenario();
    try {
      const dbPath = path.join(dir.root, "depot.db");
      const client = new DatabaseSync(dbPath);
      client.exec("CREATE TABLE fixture (id TEXT PRIMARY KEY, label TEXT NOT NULL)");
      client.exec("INSERT INTO fixture (id, label) VALUES ('a', 'alpha')");
      client.close();

      const exp = createExpectHelper({ scenarioRoot: dir.root });
      exp.dbHas("fixture", { id: "a" });

      let threw = false;
      try {
        exp.dbHas("fixture", { id: "missing" });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      await handle.cleanup();
    }
  });

  it("contains() / notContains() report failures via thrown errors", () => {
    const exp = createExpectHelper({ scenarioRoot: "/tmp/does-not-need-to-exist" });
    exp.contains("hello world", "world");
    let threw = false;
    try {
      exp.contains("hello world", "missing");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    exp.notContains("hello world", "absent");
    threw = false;
    try {
      exp.notContains("hello world", "world");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
