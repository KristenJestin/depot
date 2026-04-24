import { test, expect } from "@playwright/test";

test("affiche le DotLoader pendant le chargement", async ({ page }) => {
  await page.route("/api/prds", async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toBeVisible();
});

test("affiche le titre PRDs et la liste une fois chargée", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "PRDs" })).toBeVisible();
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
