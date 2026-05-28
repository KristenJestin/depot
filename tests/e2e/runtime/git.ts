import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DirHelper } from "./dir";

const execFileAsync = promisify(execFile);

/**
 * Real-git fixture helpers. We deliberately shell out to `git` (via
 * `execFile`, no shell interpolation) instead of mocking, because the
 * regressions this suite targets (worktree resolution, `.git` file vs
 * directory, `--git-common-dir`) only surface against the actual binary.
 *
 * Every commit is authored as a deterministic local identity so the test
 * environment never depends on the developer's `~/.gitconfig`.
 */

export type GitHelper = {
  initRepo(name: string, opts?: InitOptions): Promise<string>;
  initRepoIn(parentDir: string, name: string, opts?: InitOptions): Promise<string>;
  worktreeAdd(repo: string, dest: string, branch: string, fromBranch?: string): Promise<string>;
  commit(repo: string, files: Record<string, string>, message: string): Promise<void>;
  branch(repo: string, name: string, fromBranch?: string): Promise<void>;
};

export type InitOptions = {
  branches?: ReadonlyArray<string>;
};

const AUTHOR_ENV = {
  GIT_AUTHOR_NAME: "depot-e2e",
  GIT_AUTHOR_EMAIL: "depot-e2e@example.invalid",
  GIT_COMMITTER_NAME: "depot-e2e",
  GIT_COMMITTER_EMAIL: "depot-e2e@example.invalid",
};

async function git(cwd: string, args: ReadonlyArray<string>): Promise<string> {
  const { stdout } = await execFileAsync("git", args as string[], {
    cwd,
    env: { ...process.env, ...AUTHOR_ENV },
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export function createGitHelper(dir: DirHelper): GitHelper {
  async function initAt(repoPath: string, opts?: InitOptions): Promise<string> {
    await mkdir(repoPath, { recursive: true });
    await git(repoPath, ["init", "--initial-branch=main", "-q"]);
    await git(repoPath, ["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(repoPath, "README.md"), `# ${path.basename(repoPath)}\n`, "utf-8");
    await git(repoPath, ["add", "README.md"]);
    await git(repoPath, ["commit", "-q", "-m", "initial commit"]);

    if (opts?.branches) {
      for (const branchName of opts.branches) {
        await git(repoPath, ["branch", branchName]);
      }
    }
    return repoPath;
  }

  return {
    async initRepo(name, opts) {
      const repoPath = await dir.create(name);
      return initAt(repoPath, opts);
    },

    async initRepoIn(parentDir, name, opts) {
      const repoPath = path.join(parentDir, name);
      return initAt(repoPath, opts);
    },

    async worktreeAdd(repo, dest, branch, fromBranch) {
      await mkdir(path.dirname(dest), { recursive: true });
      const existing = (await git(repo, ["branch", "--list", branch])).trim();
      if (existing) {
        await git(repo, ["worktree", "add", dest, branch]);
      } else {
        const base = fromBranch ?? "main";
        await git(repo, ["worktree", "add", "-b", branch, dest, base]);
      }
      return dest;
    },

    async commit(repo, files, message) {
      for (const [relPath, content] of Object.entries(files)) {
        const full = path.join(repo, relPath);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
        await git(repo, ["add", "--", relPath]);
      }
      await git(repo, ["commit", "-q", "-m", message]);
    },

    async branch(repo, name, fromBranch) {
      const args = fromBranch ? ["branch", name, fromBranch] : ["branch", name];
      await git(repo, args);
    },
  };
}
