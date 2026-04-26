import { test, expect } from "@playwright/test";

test("affiche le DotLoader pendant le chargement", async ({ page }) => {
  await page.route("/api/prds", async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status")).toBeVisible({ timeout: 3000 });
});

test("affiche le titre PRDs et la liste une fois chargée", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "PRDs", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).not.toBeVisible({ timeout: 5000 });
});

test("affiche EmptyState quand l'API retourne une liste vide", async ({ page }) => {
  await page.route("/api/prds", (route) => route.fulfill({ json: { prds: [] } }));
  await page.goto("/");
  await expect(page.getByText("No PRDs yet.")).toBeVisible();
});

test("affiche les cartes PRD avec leur StatusBadge", async ({ page }) => {
  await page.route("/api/prds", (route) =>
    route.fulfill({
      json: {
        prds: [{ id: "1", title: "Mon PRD", status: "in_progress", context: null, updatedAt: 0 }],
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("Mon PRD")).toBeVisible();
  await expect(page.getByText("In progress")).toBeVisible();
});

test("cliquer sur une card navigue vers le PRD detail", async ({ page }) => {
  await page.route("/api/prds", (route) =>
    route.fulfill({
      json: {
        prds: [
          { id: "abc123", title: "Mon PRD", status: "in_progress", context: null, updatedAt: 0 },
        ],
      },
    }),
  );
  await page.route("/api/prds/abc123", (route) =>
    route.fulfill({
      json: {
        prd: {
          id: "abc123",
          title: "Mon PRD",
          status: "in_progress",
          revision: 1,
          context: null,
          scope: null,
          createdAt: Date.now(),
          activatedAt: null,
          updatedAt: Date.now(),
        },
        tasks: [],
        review: null,
      },
    }),
  );
  await page.goto("/");
  await page.getByText("Mon PRD").click();
  await expect(page).toHaveURL(/\/prds\/abc123/);
  await expect(page.getByText("PRDs /")).toBeVisible();
});
