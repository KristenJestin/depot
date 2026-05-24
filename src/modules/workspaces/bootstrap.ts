import path from "node:path";
import { execFile } from "node:child_process";
import type { Database } from "#/db/client";
import { addWorkspace, createProject, getProject, resolveWorkspace } from "#/lib/workflow";
import { normalizeWorkspacePath } from "#/shared/utils";

/**
 * Paths where silent auto-create would produce a workspace so broad it
 * shadows every project beneath it (PRD 0004). Currently:
 *   - the user's home directory exactly
 *   - the filesystem root `/`
 *
 * Non-git folders are deliberately NOT in this list — a project may
 * legitimately not be a git repo.
 */
function isForbiddenAutoCreatePath(canonicalPath: string): boolean {
  if (canonicalPath === "/") return true;
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return false;
  return canonicalPath === normalizeWorkspacePath(home);
}

interface GitContext {
  gitRoot: string;
  branch: string | undefined;
  /** Path of the main worktree if this is a linked worktree, otherwise undefined. */
  mainWorktreePath?: string;
}

function spawnGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout as string);
    });
  });
}

/** Returns git root and current branch for the given directory, or null if not in a git repo. */
export async function detectGitContext(cwd: string): Promise<GitContext | null> {
  let gitRoot: string;
  try {
    gitRoot = (await spawnGit(["rev-parse", "--show-toplevel"], cwd)).trim();
  } catch {
    return null;
  }

  let branch: string | undefined;
  try {
    branch = (await spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
  } catch {
    branch = undefined;
  }

  const mainWorktreePath = await detectMainWorktree(cwd, gitRoot);

  return { gitRoot, branch, mainWorktreePath };
}

/**
 * Returns the main worktree path if `cwd` is a linked git worktree, or undefined if it is the
 * main worktree itself.
 */
async function detectMainWorktree(cwd: string, gitRoot: string): Promise<string | undefined> {
  let output: string;
  try {
    output = await spawnGit(["worktree", "list", "--porcelain"], cwd);
  } catch {
    return undefined;
  }

  const worktrees = parseWorktreeList(output);
  if (worktrees.length === 0) return undefined;

  const mainPath = worktrees[0];
  // path.resolve normalizes both paths before comparison, handling platform differences
  // (Windows backslashes vs POSIX forward slashes, trailing separators).
  if (path.resolve(mainPath) === path.resolve(gitRoot)) return undefined;

  return mainPath;
}

/** Parses `git worktree list --porcelain` output and returns an array of worktree paths. */
function parseWorktreeList(output: string): string[] {
  const paths: string[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length).trim());
    }
  }
  return paths;
}

export async function resolveOrCreateWorkspaceForPath(db: Database, currentPath: string) {
  const normalizedPath = normalizeWorkspacePath(currentPath);
  const existingWorkspace = await resolveWorkspace(db, normalizedPath);
  if (existingWorkspace) {
    const existingProject = await getProject(db, existingWorkspace.projectId);
    if (!existingProject) {
      throw new Error(`Project not found: ${existingWorkspace.projectId}`);
    }

    return {
      workspace: existingWorkspace,
      project: existingProject,
      created: false,
    };
  }

  if (isForbiddenAutoCreatePath(normalizedPath)) {
    throw new Error(
      `Refusing to auto-create a workspace at '${normalizedPath}' — this path is too broad and would shadow every project beneath it. ` +
        `Cd into a project directory, or run \`depot init <name>\` from the intended project root to create a workspace explicitly.`,
    );
  }

  const git = await detectGitContext(currentPath);
  const label = git?.branch;

  // If this is a linked worktree and its main worktree already has a registered workspace,
  // attach to that project instead of creating a new one.
  let project = git?.mainWorktreePath
    ? await resolveProjectForMainWorktree(db, git.mainWorktreePath)
    : undefined;

  if (!project) {
    const projectName = git
      ? path.basename(git.gitRoot)
      : path.basename(path.resolve(currentPath)) || "project";
    project = await createProject(db, { name: projectName });
  }

  const workspace = await addWorkspace(db, {
    projectId: project.id,
    path: normalizedPath,
    label,
  });

  return {
    workspace,
    project,
    created: true,
  };
}

async function resolveProjectForMainWorktree(db: Database, mainPath: string) {
  const normalized = normalizeWorkspacePath(mainPath);
  const ws = await resolveWorkspace(db, normalized);
  if (!ws) return undefined;
  return getProject(db, ws.projectId);
}
