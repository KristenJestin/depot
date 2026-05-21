// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { DiffViewer, type DiffAnnotation } from "#/web/components/diff-viewer";

/**
 * `DiffViewer` renders through `@pierre/diffs`' `PatchDiff`, whose diff body is
 * a virtualized custom element (`<diffs-container>`). Under happy-dom there is
 * no layout so the code rows do not materialize — these tests assert the file
 * header, collapse control, and annotation rendering, which are the testable
 * surface. Row-level interaction is covered by the Playwright e2e suite.
 */
const DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 0000000..1111111 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
diff --git a/src/bar.ts b/src/bar.ts
index 2222222..3333333 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`;

describe("DiffViewer (@pierre/diffs)", () => {
  it("renders the working-tree-clean message for an empty diff", () => {
    const { container } = render(
      <DiffViewer diff="" annotations={[]} onAnnotationsChange={() => {}} />,
    );
    expect(container.textContent).toContain("The working tree is clean.");
  });

  it("renders one collapsible file panel per file in a multi-file diff", () => {
    const { container } = render(
      <DiffViewer diff={DIFF} annotations={[]} onAnnotationsChange={() => {}} />,
    );
    const panels = container.querySelectorAll("[data-file-path]");
    expect(panels.length).toBe(2);
    expect(container.querySelector('[data-file-path="src/foo.ts"]')).not.toBeNull();
    expect(container.querySelector('[data-file-path="src/bar.ts"]')).not.toBeNull();
  });

  it("renders the @pierre/diffs diff body without a per-line table separator", () => {
    const { container } = render(
      <DiffViewer diff={DIFF} annotations={[]} onAnnotationsChange={() => {}} />,
    );
    // Classic @pierre/diffs rendering uses a <diffs-container>, not a table
    // with a separator row between every line.
    expect(container.querySelector("diffs-container")).not.toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });

  it("shows file +/- counts on the file header", () => {
    const { container } = render(
      <DiffViewer diff={DIFF} annotations={[]} onAnnotationsChange={() => {}} />,
    );
    const fooPanel = container.querySelector('[data-file-path="src/foo.ts"]')!;
    expect(fooPanel.textContent).toContain("+1");
    expect(fooPanel.textContent).toContain("−1");
    const barPanel = container.querySelector('[data-file-path="src/bar.ts"]')!;
    expect(barPanel.textContent).toContain("+1");
    expect(barPanel.textContent).toContain("−0");
  });

  it("collapses a file when its header chevron is clicked (default expanded)", () => {
    const { container } = render(
      <DiffViewer diff={DIFF} annotations={[]} onAnnotationsChange={() => {}} />,
    );
    const fooPanel = container.querySelector('[data-file-path="src/foo.ts"]')!;
    const header = fooPanel.querySelector("button")!;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(fooPanel.querySelector("diffs-container")).not.toBeNull();

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(fooPanel.querySelector("diffs-container")).toBeNull();

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(fooPanel.querySelector("diffs-container")).not.toBeNull();
  });

  it("renders an annotation anchored to a deleted line on the deletions side", () => {
    const annotations: DiffAnnotation[] = [
      {
        filePath: "src/foo.ts",
        startLine: 2,
        endLine: 2,
        text: "this removed line was load-bearing",
        kind: "finding",
        side: "del",
      },
    ];
    const { container } = render(
      <DiffViewer diff={DIFF} annotations={annotations} onAnnotationsChange={() => {}} />,
    );
    expect(container.textContent).toContain("this removed line was load-bearing");
    // The annotation must be anchored to the deletions side, not additions.
    expect(container.querySelector('[slot="annotation-deletions-2"]')).not.toBeNull();
    expect(container.querySelector('[slot="annotation-additions-2"]')).toBeNull();
  });

  it("renders an annotation anchored to an added line on the additions side", () => {
    const annotations: DiffAnnotation[] = [
      {
        filePath: "src/bar.ts",
        startLine: 2,
        endLine: 2,
        text: "added line note",
        kind: "deferred-question",
        side: "add",
      },
    ];
    const { container } = render(
      <DiffViewer diff={DIFF} annotations={annotations} onAnnotationsChange={() => {}} />,
    );
    expect(container.textContent).toContain("added line note");
    expect(container.querySelector('[slot="annotation-additions-2"]')).not.toBeNull();
  });

  it("removes an annotation when its remove button is clicked", () => {
    let next: DiffAnnotation[] | null = null;
    const annotations: DiffAnnotation[] = [
      {
        filePath: "src/foo.ts",
        startLine: 2,
        endLine: 2,
        text: "removable",
        kind: "finding",
        side: "del",
      },
    ];
    const { container } = render(
      <DiffViewer
        diff={DIFF}
        annotations={annotations}
        onAnnotationsChange={(updated) => {
          next = updated;
        }}
      />,
    );
    const removeButton = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "remove",
    )!;
    fireEvent.click(removeButton);
    expect(next).toEqual([]);
  });
});
