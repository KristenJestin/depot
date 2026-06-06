// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";

/**
 * The `app-shell` layout wraps every route: a left sidebar plus the route
 * content rendered inside the card-framed main area.
 */
vi.mock("#/web/components/app-sidebar", () => ({
  AppSidebar: () => <aside data-testid="app-sidebar">sidebar</aside>,
}));

import { AppShell } from "#/web/components/app-shell";

describe("AppShell", () => {
  it("renders the sidebar alongside the route content in the main area", () => {
    render(
      <AppShell>
        <div data-testid="route-content">route body</div>
      </AppShell>,
    );

    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();

    const content = screen.getByTestId("route-content");
    expect(content).toBeInTheDocument();
    expect(content.closest("main")).not.toBeNull();
  });

  it("contains the page scroll: main is overflow-hidden so the card frame never gets pushed out", () => {
    render(
      <AppShell>
        <div data-testid="route-content">route body</div>
      </AppShell>,
    );
    const main = screen.getByTestId("route-content").closest("main");
    expect(main).not.toBeNull();
    // PRD 0026 / S1 — the global main must NOT absorb the vertical scroll of
    // the routes. Each route declares its own scrollable region.
    expect(main!.className).toContain("overflow-hidden");
    expect(main!.className).not.toContain("overflow-auto");
  });
});
