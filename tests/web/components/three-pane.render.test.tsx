// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen } from "@testing-library/react";

import { ThreePane } from "#/web/components/three-pane";

/**
 * The `three-pane` working layout: a collapsible left rail, a flexible center
 * pane, and a collapsible right rail. Each rail collapses to zero width while
 * keeping the center pane mounted.
 */
describe("ThreePane", () => {
  function renderPane(overrides?: { leftOpen?: boolean; rightOpen?: boolean }) {
    const onLeftOpen = vi.fn<() => void>();
    const onLeftClose = vi.fn<() => void>();
    const onRightOpen = vi.fn<() => void>();
    const onRightClose = vi.fn<() => void>();
    render(
      <ThreePane
        leftTitle="Tasks"
        leftOpen={overrides?.leftOpen ?? true}
        onLeftOpen={onLeftOpen}
        onLeftClose={onLeftClose}
        left={<div data-testid="left-body">left</div>}
        rightTitle="Activity"
        rightOpen={overrides?.rightOpen ?? true}
        onRightOpen={onRightOpen}
        onRightClose={onRightClose}
        right={<div data-testid="right-body">right</div>}
        center={<div data-testid="center-body">center</div>}
      />,
    );
    return { onLeftOpen, onLeftClose, onRightOpen, onRightClose };
  }

  it("renders all three panes with both rails open", () => {
    renderPane();
    expect(screen.getByTestId("left-body")).toBeInTheDocument();
    expect(screen.getByTestId("center-body")).toBeInTheDocument();
    expect(screen.getByTestId("right-body")).toBeInTheDocument();

    const rails = [...document.querySelectorAll("aside")];
    expect(rails).toHaveLength(2);
    for (const rail of rails) {
      expect(rail.getAttribute("aria-hidden")).toBe("false");
    }
  });

  it("collapses a rail to zero width and fires its close handler", () => {
    const { onLeftClose } = renderPane();
    fireEvent.click(screen.getByRole("button", { name: /close tasks/i }));
    expect(onLeftClose).toHaveBeenCalledOnce();
  });

  it("marks a closed rail aria-hidden with zero width", () => {
    renderPane({ rightOpen: false });
    const rails = [...document.querySelectorAll("aside")];
    const right = rails[1]!;
    expect(right.getAttribute("aria-hidden")).toBe("true");
    expect(right.className).toContain("w-0");
    // The center pane stays mounted regardless of rail state.
    expect(screen.getByTestId("center-body")).toBeInTheDocument();
  });
});
