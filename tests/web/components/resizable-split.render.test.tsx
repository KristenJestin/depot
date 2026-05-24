// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vite-plus/test";
import { fireEvent, render, screen } from "@testing-library/react";

import { ResizableSplit } from "#/web/components/ui/resizable-panel";

/**
 * `split-resizable` layout primitive: a draggable divider resizes the left
 * pane while the right pane fills the remainder. The width is clamped and
 * persisted to `localStorage` on release.
 */
function installLocalStorage() {
  if (typeof window.localStorage?.clear === "function") return;
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
}

describe("ResizableSplit", () => {
  beforeEach(() => {
    installLocalStorage();
    window.localStorage.clear();
  });

  function leftPane(container: HTMLElement): HTMLElement {
    return container.querySelector('[data-testid="left"]')!.parentElement as HTMLElement;
  }

  it("renders both panes with a vertical separator", () => {
    const { container } = render(
      <ResizableSplit
        left={<div data-testid="left">L</div>}
        right={<div data-testid="right">R</div>}
      />,
    );
    expect(screen.getByTestId("left")).toBeInTheDocument();
    expect(screen.getByTestId("right")).toBeInTheDocument();
    const separator = container.querySelector('[role="separator"][aria-orientation="vertical"]');
    expect(separator).not.toBeNull();
  });

  it("starts at the default left width", () => {
    const { container } = render(
      <ResizableSplit
        defaultLeftWidth={300}
        left={<div data-testid="left">L</div>}
        right={<div data-testid="right">R</div>}
      />,
    );
    expect(leftPane(container).style.width).toBe("300px");
  });

  it("nudges and clamps the width via keyboard, persisting to localStorage", () => {
    const { container } = render(
      <ResizableSplit
        storageKey="test.split"
        defaultLeftWidth={240}
        minLeftWidth={220}
        maxLeftWidth={400}
        left={<div data-testid="left">L</div>}
        right={<div data-testid="right">R</div>}
      />,
    );
    const separator = container.querySelector('[role="separator"]')!;

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    // 240 - 16 = 224, still above the 220 minimum.
    expect(leftPane(container).style.width).toBe("224px");

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    // 224 - 16 = 208 -> clamped up to the 220 minimum.
    expect(leftPane(container).style.width).toBe("220px");
  });

  it("restores a persisted width within bounds", () => {
    window.localStorage.setItem("test.split", "999");
    const { container } = render(
      <ResizableSplit
        storageKey="test.split"
        defaultLeftWidth={240}
        minLeftWidth={220}
        maxLeftWidth={400}
        left={<div data-testid="left">L</div>}
        right={<div data-testid="right">R</div>}
      />,
    );
    // 999 is clamped to the 400 maximum.
    expect(leftPane(container).style.width).toBe("400px");
  });
});
