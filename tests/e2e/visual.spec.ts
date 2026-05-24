import { test, expect, type Page } from "@playwright/test";

/**
 * Minimal visual-regression coverage for the key pages of the redesigned web UI
 * (PRD 14). Each test wires up deterministic API fixtures so the rendered page
 * is stable, then asserts against a screenshot baseline.
 *
 * Baselines are not committed. Generate them once with:
 *   bun run test:e2e -- --update-snapshots
 */

const NOW = "2026-05-20T10:00:00.000Z";
const PRD_ID = "prd-visual";
const PROJECT_ID = "proj-visual";

const PRD_ROW = {
  id: PRD_ID,
  title: "Visual baseline PRD",
  status: "in_progress" as const,
  context: null,
  updatedAt: NOW,
};

const PRD_REVISION = {
  id: PRD_ID,
  prdId: "prd-family",
  projectId: PROJECT_ID,
  workspaceId: null,
  revision: 1,
  title: "Visual baseline PRD",
  context: "A PRD used to anchor the visual-regression baseline.",
  scope: null,
  problem: null,
  solution: null,
  implementationDecisions: null,
  testingDecisions: null,
  status: "in_progress" as const,
  auditCycles: 0,
  currentPhase: 1,
  supersededAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  readyAt: NOW,
  activatedAt: NOW,
  suggestedCommitMessage: null,
};

const PRD_TASK = {
  id: "task-1",
  prdRevisionId: PRD_ID,
  position: 1,
  title: "Implement the dashboard",
  description: "Intent:\nShip the dashboard\n\nScope:\n- Render the board",
  descriptionFormat: "structured_v1" as const,
  doneCriteria: "Dashboard renders",
  dependsOn: "[]",
  effort: "m" as const,
  kind: "slice" as const,
  phaseNumber: 1,
  status: "done" as const,
  reviewId: null,
  severity: null,
  axis: null,
  triageState: "ready-for-agent" as const,
  linkedFilePath: null,
  linkedStartLine: null,
  linkedEndLine: null,
  linkedDiffSha: null,
  blockedReason: null,
  skipReason: null,
  createdAt: NOW,
  startedAt: NOW,
  completedAt: NOW,
};

/** Wires up the API routes the app shell + sidebar depend on on every page. */
async function mockShell(page: Page): Promise<void> {
  await page.route("/api/prds", (route) => route.fulfill({ json: { prds: [PRD_ROW] } }));
  await page.route("/api/context", (route) =>
    route.fulfill({ json: { workspaceId: null, workspacePath: null, workspaceLabel: null } }),
  );
  await page.route("/api/workspaces", (route) => route.fulfill({ json: { workspaces: [] } }));
}

test("project list — visual baseline", async ({ page }) => {
  await mockShell(page);
  await page.route("/api/projects", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: PROJECT_ID,
            name: "Depot",
            description: "PRD workspace tooling.",
            status: "active",
            createdAt: NOW,
            updatedAt: NOW,
            prdCount: 4,
            workspaceCount: 1,
            docCount: 2,
            directiveCount: 1,
          },
        ],
      },
    }),
  );
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Depot" })).toBeVisible();
  await expect(page).toHaveScreenshot("project-list.png", { fullPage: true });
});

test("PRD detail — visual baseline", async ({ page }) => {
  await mockShell(page);
  await page.route(`/api/prds/${PRD_ID}`, (route) =>
    route.fulfill({
      json: {
        prd: PRD_REVISION,
        tasks: [PRD_TASK],
        reviews: [],
        revisions: [PRD_REVISION],
        activity: [],
        workspace: null,
      },
    }),
  );
  await page.goto(`/prds/${PRD_ID}`);
  await expect(page.getByText("Visual baseline PRD").first()).toBeVisible();
  await expect(page).toHaveScreenshot("prd-detail.png", { fullPage: true });
});

test("project settings — visual baseline", async ({ page }) => {
  await mockShell(page);
  await page.route(`/api/projects/${PROJECT_ID}/config`, (route) =>
    route.fulfill({ json: { items: [], knownKeys: [] } }),
  );
  await page.route(`/api/projects/${PROJECT_ID}/directives`, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(`/api/projects/${PROJECT_ID}/repos`, (route) =>
    route.fulfill({ json: { items: [], implicit: false } }),
  );
  await page.route(`/api/projects/${PROJECT_ID}/docs`, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto(`/projects/${PROJECT_ID}/settings`);
  await expect(page.getByRole("heading", { name: "Configuration", exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings.png", { fullPage: true });
});
