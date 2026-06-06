// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vite-plus/test";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { EditableBadge } from "#/web/components/ui/editable-badge";

/**
 * PRD 0026 / S2 — `EditableBadge` wraps a base-ui Select around a Badge that
 * doubles as the trigger. The pencil icon hint is rendered into the DOM (its
 * visibility on hover is pure CSS opacity).
 */
describe("EditableBadge", () => {
  const OPTIONS = ["low", "normal", "high", "critical"] as const;
  type Priority = (typeof OPTIONS)[number];

  function renderBadge(overrides?: { value?: Priority; pending?: boolean }) {
    const onChange = vi.fn<(next: Priority) => void>();
    render(
      <EditableBadge<Priority>
        value={overrides?.value ?? "low"}
        variant="subtle"
        options={OPTIONS}
        onChange={onChange}
        ariaLabel="PRD priority"
        pending={overrides?.pending}
      />,
    );
    return { onChange };
  }

  it("renders the current value as the badge trigger label", () => {
    renderBadge({ value: "high" });
    const trigger = screen.getByRole("combobox", { name: "PRD priority" });
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain("high");
  });

  it("exposes the ariaLabel on the trigger", () => {
    renderBadge();
    expect(screen.getByRole("combobox", { name: "PRD priority" })).toBeInTheDocument();
  });

  it("renders a pencil icon hint in the DOM for the hover affordance", () => {
    renderBadge();
    // The hover hint is a lucide icon — its visibility is opacity-only CSS, so
    // we only assert presence in the DOM.
    const pencil = document.querySelector("[data-testid='editable-badge-pencil']");
    expect(pencil).not.toBeNull();
  });

  it("opens the Select popup on click and shows all options anchored to the badge", async () => {
    renderBadge({ value: "low" });
    const trigger = screen.getByRole("combobox", { name: "PRD priority" });
    await act(async () => {
      fireEvent.click(trigger);
    });
    // Every priority option appears in the open popup.
    for (const option of OPTIONS) {
      const node = await screen.findByRole("option", { name: option });
      expect(node).toBeInTheDocument();
    }
  });

  it("renders one option per entry in `options`, each as a real listbox option", async () => {
    renderBadge({ value: "low" });
    const trigger = screen.getByRole("combobox", { name: "PRD priority" });
    await act(async () => {
      fireEvent.click(trigger);
    });
    const options = await screen.findAllByRole("option");
    expect(options.map((node) => node.textContent?.trim())).toEqual([...OPTIONS]);
  });

  // Note on `onChange` activation: base-ui's `Select` items dispatch their
  // `item-press` event through Floating UI's pointer pipeline, which
  // happy-dom does not fully synthesise (no real pointer activation). The
  // end-to-end "click an option, see PATCH fire" behaviour is covered by
  // the Playwright spec `prd-priority-edit.spec.ts`; the unit test only
  // verifies the options are rendered and wired to the trigger.

  it("disables the trigger when pending is true", () => {
    renderBadge({ pending: true });
    const trigger = screen.getByRole("combobox", { name: "PRD priority" });
    expect(
      trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });
});
