// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
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
});
