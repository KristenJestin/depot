import { test, expect, type Page } from "@playwright/test";

/**
 * PRD 0026 / S1 — scroll containment on `/prds/$id`.
 *
 * Verifies that the rounded `Card` that frames the page stays visible edge to
 * edge after scrolling, i.e. the bottom border never gets pushed below the
 * viewport. The center pane of the `ThreePane` carries the scroll, not the
 * global `<main>`.
 */

const NOW = "2026-05-20T10:00:00.000Z";
const PRD_ID = "prd-scroll-long";
const PROJECT_ID = "proj-scroll";

const PRD_ROW = {
  id: PRD_ID,
  title: "Long PRD for scroll containment",
  status: "in_progress" as const,
  context: null,
  updatedAt: NOW,
};

// Pad context with enough content to force vertical overflow even at 1080px
// viewport height. Each "paragraph N" line is a separate paragraph so the
// markdown renderer stacks them rather than wrapping inside one big block.
const LONG_CONTEXT = Array.from(
  { length: 200 },
  (_, i) =>
    `paragraph ${i + 1} — lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
).join("\n\n");

const PRD_REVISION = {
  id: PRD_ID,
  prdId: "prd-family-scroll",
  projectId: PROJECT_ID,
  workspaceId: null,
  revision: 1,
  title: "Long PRD for scroll containment",
  context: LONG_CONTEXT,
  scope: LONG_CONTEXT,
  problem: LONG_CONTEXT,
  solution: LONG_CONTEXT,
  implementationDecisions: LONG_CONTEXT,
  testingDecisions: LONG_CONTEXT,
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

async function mockShell(page: Page): Promise<void> {
  await page.route("/api/prds", (route) => route.fulfill({ json: { prds: [PRD_ROW] } }));
  await page.route("/api/context", (route) =>
    route.fulfill({ json: { workspaceId: null, workspacePath: null, workspaceLabel: null } }),
  );
  await page.route("/api/workspaces", (route) => route.fulfill({ json: { workspaces: [] } }));
}

test("PRD detail: rounded Card frame stays edge-to-edge after max vertical scroll", async ({
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
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/prds/${PRD_ID}`);
  await expect(page.getByText("Long PRD for scroll containment").first()).toBeVisible();

  // The card frame is the rounded `<div class="…rounded-xl…">` that wraps the
  // page content inside `<main>`. Locate it via its parent main first.
  const main = page.locator("main").first();
  const card = main.locator("> div.rounded-xl").first();
  await expect(card).toBeVisible();

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport size missing");

  // Before scroll: the card bottom is inside the viewport (the rounded corner
  // is visible).
  const beforeBox = await card.boundingBox();
  expect(beforeBox).not.toBeNull();
  expect(beforeBox!.y + beforeBox!.height).toBeLessThanOrEqual(viewport.height);

  // Scroll the long center pane of the ThreePane to its maximum.
  await page.evaluate(() => {
    // The center pane is the only scrollable region inside `<main>` with a
    // significant scrollHeight overhead. Pick the first element under main
    // that actually has overflow content to scroll.
    const main = document.querySelector("main");
    if (!main) return;
    const candidates = Array.from(main.querySelectorAll("*")) as HTMLElement[];
    const scrollable = candidates.find((el) => {
      const style = window.getComputedStyle(el);
      const canScrollY = style.overflowY === "auto" || style.overflowY === "scroll";
      return canScrollY && el.scrollHeight - el.clientHeight > 100;
    });
    if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
  });

  // After max scroll: the card frame must still be visible edge to edge, i.e.
  // the rounded `<div>` bottom must still be inside the viewport.
  const afterBox = await card.boundingBox();
  expect(afterBox).not.toBeNull();
  expect(afterBox!.y + afterBox!.height).toBeLessThanOrEqual(viewport.height);
  // And its top must still be at (or just below) the viewport top — i.e. the
  // global `<main>` did NOT scroll up.
  expect(afterBox!.y).toBeGreaterThanOrEqual(0);
});
