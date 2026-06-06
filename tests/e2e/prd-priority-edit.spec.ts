import { test, expect, type Page, type Request } from "@playwright/test";

/**
 * PRD 0026 / S2 — clicking the priority badge in the PRD header opens the
 * priority dropdown and selecting a new value fires
 * `PATCH /api/prds/:id/priority`. The header no longer renders a separate
 * status badge.
 */

const NOW = "2026-05-20T10:00:00.000Z";
const PRD_ID = "prd-priority-edit";
const PROJECT_ID = "proj-priority-edit";

const PRD_ROW = {
  id: PRD_ID,
  title: "Priority edit PRD",
  status: "in_progress" as const,
  context: null,
  updatedAt: NOW,
};

const PRD_REVISION = {
  id: PRD_ID,
  prdId: "prd-family-priority",
  projectId: PROJECT_ID,
  workspaceId: null,
  revision: 1,
  title: "Priority edit PRD",
  context: "Short body.",
  scope: null,
  problem: null,
  solution: null,
  implementationDecisions: null,
  testingDecisions: null,
  status: "in_progress" as const,
  priority: "low" as const,
  auditCycles: 0,
  currentPhase: 1,
  supersededAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  readyAt: NOW,
  activatedAt: NOW,
  suggestedCommitMessage: null,
};

async function mockShell(page: Page): Promise<void> {
  await page.route("/api/prds", (route) => route.fulfill({ json: { prds: [PRD_ROW] } }));
  await page.route("/api/context", (route) =>
    route.fulfill({ json: { workspaceId: null, workspacePath: null, workspaceLabel: null } }),
  );
  await page.route("/api/workspaces", (route) => route.fulfill({ json: { workspaces: [] } }));
}

test("PRD header: clicking the priority badge opens the dropdown and PATCH fires", async ({
  page,
}) => {
  await mockShell(page);
  await page.route(`/api/prds/${PRD_ID}`, (route) =>
    route.fulfill({
      json: {
        prd: PRD_REVISION,
        tasks: [],
        reviews: [],
        revisions: [PRD_REVISION],
        activity: [],
        workspace: null,
        tags: [],
        dependencies: [],
        dependents: [],
        targetVersion: null,
        annexes: [],
      },
    }),
  );

  const patchRequests: Request[] = [];
  await page.route(`/api/prds/${PRD_ID}/priority`, async (route) => {
    patchRequests.push(route.request());
    await route.fulfill({ status: 200, json: { ok: true } });
  });

  await page.goto(`/prds/${PRD_ID}`);
  await expect(page.getByText("Priority edit PRD").first()).toBeVisible();

  // Locate the editable priority badge. It is the only combobox in the header
  // with the `PRD priority` aria-label.
  const priorityBadge = page.getByRole("combobox", { name: "PRD priority" }).first();
  await expect(priorityBadge).toBeVisible();
  await expect(priorityBadge).toContainText("low");

  // Click to open the popup.
  await priorityBadge.click();

  // Select the `high` option.
  const highOption = page.getByRole("option", { name: "high" });
  await expect(highOption).toBeVisible();
  await highOption.click();

  // The PATCH request fires with `{ priority: "high" }`.
  await expect.poll(() => patchRequests.length).toBeGreaterThan(0);
  expect(patchRequests[0]!.method()).toBe("PATCH");
  expect(patchRequests[0]!.postDataJSON()).toEqual({ priority: "high" });
});
