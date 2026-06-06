// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { SidebarItemList } from "#/web/components/ui/sidebar-item-list";

/**
 * PRD 0026 / S3 — generic list primitive shared by the Tags, Milestone and
 * Dependencies widgets. Tests cover both layouts, the empty fallback and
 * the remove-button wiring, but stay agnostic of any data fetching.
 */

type Item = { id: string; label: string };

const ITEMS: Item[] = [
  { id: "a", label: "alpha" },
  { id: "b", label: "beta" },
];

describe("SidebarItemList", () => {
  it("renders an item per entry in the `pills` layout via the render props", () => {
    render(
      <SidebarItemList<Item>
        items={ITEMS}
        emptyLabel="No items."
        layout="pills"
        renderIcon={() => <span data-testid="leading-icon" />}
        renderLabel={(item) => <span>{item.label}</span>}
        getKey={(item) => item.id}
      />,
    );

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getAllByTestId("leading-icon")).toHaveLength(2);
    expect(screen.queryByText("No items.")).not.toBeInTheDocument();
  });

  it("renders the empty label when there are no items", () => {
    render(
      <SidebarItemList<Item>
        items={[]}
        emptyLabel="No items here yet."
        layout="rows"
        renderIcon={() => null}
        renderLabel={() => null}
        getKey={(item) => item.id}
      />,
    );

    expect(screen.getByText("No items here yet.")).toBeInTheDocument();
  });

  it("calls onRemove with the item when the X button is clicked", () => {
    const onRemove = vi.fn<(item: Item) => void>();
    render(
      <SidebarItemList<Item>
        items={ITEMS}
        emptyLabel="No items."
        layout="rows"
        renderIcon={() => null}
        renderLabel={(item) => <span>{item.label}</span>}
        getKey={(item) => item.id}
        onRemove={onRemove}
      />,
    );

    // The remove button's accessible label is derived from the item's key so
    // screen readers always announce a stable identifier.
    const removeBetaButton = screen.getByRole("button", { name: /remove b/i });
    fireEvent.click(removeBetaButton);
    expect(onRemove).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("disables remove buttons when `pending` is true", () => {
    const onRemove = vi.fn<(item: Item) => void>();
    render(
      <SidebarItemList<Item>
        items={ITEMS}
        emptyLabel="No items."
        layout="pills"
        renderIcon={() => null}
        renderLabel={(item) => <span>{item.label}</span>}
        getKey={(item) => item.id}
        onRemove={onRemove}
        pending
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(buttons[0]!);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("does not render remove buttons when no `onRemove` is provided", () => {
    render(
      <SidebarItemList<Item>
        items={ITEMS}
        emptyLabel="No items."
        layout="rows"
        renderIcon={() => null}
        renderLabel={(item) => <span>{item.label}</span>}
        getKey={(item) => item.id}
      />,
    );
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("switches between `pills` (flex-wrap) and `rows` (stacked) layouts", () => {
    const { rerender } = render(
      <SidebarItemList<Item>
        items={ITEMS}
        emptyLabel="No items."
        layout="pills"
        renderIcon={() => null}
        renderLabel={(item) => <span>{item.label}</span>}
        getKey={(item) => item.id}
      />,
    );

    const pillsList = screen.getByRole("list");
    expect(pillsList.className).toContain("flex-wrap");

    rerender(
      <SidebarItemList<Item>
        items={ITEMS}
        emptyLabel="No items."
        layout="rows"
        renderIcon={() => null}
        renderLabel={(item) => <span>{item.label}</span>}
        getKey={(item) => item.id}
      />,
    );

    const rowsList = screen.getByRole("list");
    expect(rowsList.className).not.toContain("flex-wrap");
  });
});
