import { test, expect } from "@playwright/test";

const PRD_ID = "prd-rd-e2e";

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

/** Wires up the API routes the review-diff page depends on. */
async function mockReviewDiff(page: import("@playwright/test").Page) {
  await page.route(`/api/prds/${PRD_ID}`, (route) =>
    route.fulfill({
      json: {
        prd: {
          id: PRD_ID,
          title: "Review Diff PRD",
          status: "in_progress",
          revision: 1,
          context: null,
          scope: null,
          currentPhase: null,
          createdAt: Date.now(),
          activatedAt: null,
          updatedAt: Date.now(),
        },
        tasks: [],
        review: null,
      },
    }),
  );
  await page.route(new RegExp(`/api/prds/${PRD_ID}/diff`), (route) =>
    route.fulfill({
      json: {
        mode: "working-tree",
        since: null,
        until: null,
        diff: DIFF,
        files: [
          { path: "src/foo.ts", additions: 1, deletions: 1 },
          { path: "src/bar.ts", additions: 1, deletions: 0 },
        ],
        repos: [
          {
            repoName: "(default)",
            repoPath: "/repo",
            sha: null,
            diff: DIFF,
            files: [
              { path: "src/foo.ts", additions: 1, deletions: 1 },
              { path: "src/bar.ts", additions: 1, deletions: 0 },
            ],
          },
        ],
      },
    }),
  );
  await page.route(new RegExp(`/api/prds/${PRD_ID}/context-panel`), (route) =>
    route.fulfill({
      json: { reviewBrief: null, currentPhaseTasks: [], futurePhases: [], outOfScopeItems: [] },
    }),
  );
  await page.route(new RegExp(`/api/prds/${PRD_ID}/commit-suggestion`), (route) =>
    route.fulfill({
      json: {
        phase: null,
        phaseSuggestedCommitMessage: null,
        prdSuggestedCommitMessage: null,
        suggestedCommitMessage: null,
      },
    }),
  );
}

test("review-diff renders one file panel per file", async ({ page }) => {
  await mockReviewDiff(page);
  await page.goto(`/prds/${PRD_ID}/review-diff`);
  await expect(page.locator('[data-file-path="src/foo.ts"]')).toBeVisible();
  await expect(page.locator('[data-file-path="src/bar.ts"]')).toBeVisible();
});

test("review-diff sidebars are closed by default and open via their toggles", async ({ page }) => {
  await mockReviewDiff(page);
  await page.goto(`/prds/${PRD_ID}/review-diff`);
  await expect(page.locator('[data-file-path="src/foo.ts"]')).toBeVisible();

  const sidebars = page.locator("aside");
  await expect(sidebars.nth(0)).toHaveAttribute("aria-hidden", "true");
  await expect(sidebars.nth(1)).toHaveAttribute("aria-hidden", "true");

  await page.getByRole("button", { name: /Files/ }).click();
  await expect(sidebars.nth(0)).toHaveAttribute("aria-hidden", "false");

  await page.getByRole("button", { name: /Context/ }).click();
  await expect(sidebars.nth(1)).toHaveAttribute("aria-hidden", "false");
});

test("review-diff collapses a file from its header chevron", async ({ page }) => {
  await mockReviewDiff(page);
  await page.goto(`/prds/${PRD_ID}/review-diff`);
  const panel = page.locator('[data-file-path="src/foo.ts"]');
  await expect(panel).toBeVisible();

  const header = panel.getByRole("button").first();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
});

test("review-diff lets a reviewer comment on a deleted line", async ({ page }) => {
  await mockReviewDiff(page);
  await page.goto(`/prds/${PRD_ID}/review-diff`);
  const panel = page.locator('[data-file-path="src/foo.ts"]');
  await expect(panel).toBeVisible();

  // Click the line number gutter of the deleted line (`const b = 2;`).
  await panel.getByText("const b = 2;").click();

  const editor = panel.getByPlaceholder(/removed line/i);
  await expect(editor).toBeVisible();
  await editor.fill("this deleted line mattered");
  await panel.getByRole("button", { name: "Submit" }).click();

  await expect(panel.getByText("this deleted line mattered")).toBeVisible();
});
