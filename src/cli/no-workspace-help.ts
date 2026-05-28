import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Database } from "#/db/client";

const execFileAsync = promisify(execFile);

export type GitRootDetector = (cwd: string) => Promise<string | null>;

async function defaultDetectGitRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    const trimmed = stdout.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function isAncestor(parent: string, child: string): boolean {
  // Strip a trailing slash on `parent` so a legacy workspace row stored with
  // a trailing `/` still matches a descendant cwd (otherwise we end up
  // comparing against `…/proj//sub`, which never matches).
  const normalizedParent = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  if (normalizedParent === child) return false;
  return child.startsWith(normalizedParent + "/");
}

/**
 * Compose a guidance-rich error message when no workspace matches the cwd.
 *
 * Inspects the database for workspaces that are ancestors of the cwd and,
 * if none, asks git whether the cwd belongs to a repo. Suggests concrete
 * `cd` / `depot workspace add` commands with the relevant paths and project
 * names pre-filled so the user (or agent) can copy-paste the fix.
 */
export async function buildNoWorkspaceMessage(
  cwd: string,
  db: Database,
  detectGitRoot: GitRootDetector = defaultDetectGitRoot,
): Promise<string> {
  const lines: string[] = [];
  lines.push(`No workspace found for current directory: ${cwd}`);
  lines.push("");

  // Independent reads on the error path — parallelise the two SQLite round-trips.
  const [allWorkspaces, allProjects] = await Promise.all([
    db.query.workspaces.findMany(),
    db.query.projects.findMany(),
  ]);
  // Longest path first = closest ancestor first.
  const ancestors = allWorkspaces
    .filter((w) => isAncestor(w.path, cwd))
    .sort((a, b) => b.path.length - a.path.length);

  if (ancestors.length > 0) {
    const projectName = (id: string) =>
      (allProjects as Array<{ id: string; name: string }>).find((p) => p.id === id)?.name ?? id;
    lines.push("This folder is inside an existing workspace. Suggestions:");
    lines.push("");
    for (const ws of ancestors.slice(0, 3)) {
      const proj = projectName(ws.projectId);
      const label = ws.label ?? "(unlabeled)";
      lines.push(`  cd ${ws.path}    # workspace '${label}', project '${proj}'`);
    }
    lines.push("");
    const closest = ancestors[0]!;
    lines.push("Or register the current folder as a new workspace of the same project:");
    lines.push(
      `  depot workspace add --project ${projectName(closest.projectId)} --label <label> --path ${cwd}`,
    );
    return lines.join("\n");
  }

  const gitRoot = await detectGitRoot(cwd);
  if (gitRoot && gitRoot !== cwd) {
    lines.push(`This folder is inside a git repo rooted at: ${gitRoot}`);
    lines.push("");
    lines.push("Suggestions:");
    lines.push(`  depot workspace add --project <id|name> --label <label> --path ${gitRoot}`);
    lines.push(`  depot init    # if you want a new project here instead`);
    return lines.join("\n");
  }

  lines.push("Suggestions:");
  lines.push(`  depot init    # create a new project here`);
  lines.push(
    `  depot workspace add --project <id|name> --label <label> --path ${cwd}    # attach to an existing project`,
  );
  return lines.join("\n");
}
