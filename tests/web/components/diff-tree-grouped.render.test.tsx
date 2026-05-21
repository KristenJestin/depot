// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DiffTree, DiffTreeGrouped, type DiffTreeRepoGroup } from "#/web/components/diff-tree";

/**
 * `DiffTree`/`DiffTreeGrouped` render through `@pierre/trees`, whose file tree
 * is a virtualized custom element. Under happy-dom there is no layout, so no
 * rows materialize — these tests assert the tree host mounts and the empty
 * state renders, which is the testable surface without a real browser. Row
 * interaction is covered by the Playwright e2e suite.
 */
describe("DiffTreeGrouped — multi-repo file sidebar (@pierre/trees)", () => {
  it("mounts the @pierre/trees file-tree host for a multi-repo diff", () => {
    const groups: DiffTreeRepoGroup[] = [
      {
        repoName: "front",
        files: [{ path: "src/app.tsx", key: "front:src/app.tsx", status: "M" }],
      },
      {
        repoName: "api",
        files: [
          { path: "src/server.ts", key: "api:src/server.ts", status: "M" },
          { path: "src/db.ts", key: "api:src/db.ts", status: "A" },
        ],
      },
    ];
    const { container } = render(<DiffTreeGrouped groups={groups} />);
    expect(container.querySelector("file-tree-container")).not.toBeNull();
  });

  it("mounts the file-tree host for a single (mono-repo) group", () => {
    const groups: DiffTreeRepoGroup[] = [
      {
        repoName: "(default)",
        files: [{ path: "README.md", key: "(default):README.md", status: "M" }],
      },
    ];
    const { container } = render(<DiffTreeGrouped groups={groups} />);
    expect(container.querySelector("file-tree-container")).not.toBeNull();
  });

  it("shows an empty state when no repo has changes", () => {
    const groups: DiffTreeRepoGroup[] = [
      { repoName: "front", files: [] },
      { repoName: "api", files: [] },
    ];
    const { container } = render(<DiffTreeGrouped groups={groups} />);
    expect(container.textContent).toContain("No files changed.");
    expect(container.querySelector("file-tree-container")).toBeNull();
  });

  it("DiffTree mounts the file-tree host for a flat file list", () => {
    const { container } = render(<DiffTree files={[{ path: "src/index.ts", status: "M" }]} />);
    expect(container.querySelector("file-tree-container")).not.toBeNull();
  });

  it("DiffTree shows the empty state for no files", () => {
    const { container } = render(<DiffTree files={[]} />);
    expect(container.textContent).toContain("No files changed.");
  });
});
