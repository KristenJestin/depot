import { describe, expect, it } from "vite-plus/test";
import { buildNoWorkspaceMessage, type GitRootDetector } from "#/cli/no-workspace-help";

type FakeWorkspace = { id: string; path: string; label: string | null; projectId: string };
type FakeProject = { id: string; name: string };

function makeDb(workspaces: FakeWorkspace[] = [], projects: FakeProject[] = []) {
  return {
    query: {
      workspaces: { findMany: async () => workspaces },
      projects: { findMany: async () => projects },
    },
  } as unknown as Parameters<typeof buildNoWorkspaceMessage>[1];
}

const noGitRoot: GitRootDetector = async () => null;

describe("buildNoWorkspaceMessage", () => {
  it("always includes the cwd in the header", async () => {
    const msg = await buildNoWorkspaceMessage("/some/where", makeDb(), noGitRoot);
    expect(msg).toContain("/some/where");
  });

  it("falls back to generic suggestions when nothing matches", async () => {
    const msg = await buildNoWorkspaceMessage("/lonely", makeDb(), noGitRoot);
    expect(msg).toContain("depot init");
    expect(msg).toContain("depot workspace add");
    expect(msg).toContain("--path /lonely");
  });

  it("suggests the git root when cwd is inside a git repo and no ancestor workspace exists", async () => {
    const detect: GitRootDetector = async () => "/repo";
    const msg = await buildNoWorkspaceMessage("/repo/sub/folder", makeDb(), detect);
    expect(msg).toContain("git repo rooted at: /repo");
    expect(msg).toContain("depot workspace add");
    expect(msg).toContain("--path /repo");
  });

  it("does not surface a git-root suggestion when the git root equals the cwd", async () => {
    const detect: GitRootDetector = async () => "/repo";
    const msg = await buildNoWorkspaceMessage("/repo", makeDb(), detect);
    expect(msg).not.toContain("git repo rooted at:");
  });

  it("suggests cd to the parent workspace and registering under the same project", async () => {
    const db = makeDb(
      [{ id: "ws1", path: "/proj/dir", label: "main", projectId: "p1" }],
      [{ id: "p1", name: "nyx" }],
    );
    const msg = await buildNoWorkspaceMessage("/proj/dir/sub", db, noGitRoot);
    expect(msg).toContain("cd /proj/dir");
    expect(msg).toContain("workspace 'main'");
    expect(msg).toContain("project 'nyx'");
    expect(msg).toContain("--project nyx");
    expect(msg).toContain("--path /proj/dir/sub");
  });

  it("lists multiple ancestor workspaces, closest (longest path) first", async () => {
    const db = makeDb(
      [
        { id: "ws1", path: "/a", label: "outer", projectId: "p1" },
        { id: "ws2", path: "/a/b", label: "inner", projectId: "p1" },
      ],
      [{ id: "p1", name: "x" }],
    );
    const msg = await buildNoWorkspaceMessage("/a/b/c", db, noGitRoot);
    const innerIdx = msg.indexOf("cd /a/b");
    const outerIdx = msg.indexOf("cd /a    ");
    expect(innerIdx).toBeGreaterThan(-1);
    expect(outerIdx).toBeGreaterThan(innerIdx);
  });

  it("ignores a workspace whose path equals cwd (not an ancestor)", async () => {
    const db = makeDb(
      [{ id: "ws1", path: "/exact", label: "x", projectId: "p1" }],
      [{ id: "p1", name: "x" }],
    );
    const msg = await buildNoWorkspaceMessage("/exact", db, noGitRoot);
    expect(msg).not.toContain("cd /exact");
    expect(msg).toContain("depot init");
  });

  it("handles a null label gracefully", async () => {
    const db = makeDb(
      [{ id: "ws1", path: "/parent", label: null, projectId: "p1" }],
      [{ id: "p1", name: "proj" }],
    );
    const msg = await buildNoWorkspaceMessage("/parent/sub", db, noGitRoot);
    expect(msg).toContain("workspace '(unlabeled)'");
  });
});
