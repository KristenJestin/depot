// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { SettingsTree } from "#/web/components/settings-tree";

/**
 * The `docs-tree` settings rail: grouped sections that mark the active pane and
 * report selections to the parent.
 */
describe("SettingsTree", () => {
  it("renders grouped sections including doc profiles", () => {
    render(<SettingsTree active="configuration" onSelect={vi.fn<(section: string) => void>()} />);

    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Automation")).toBeInTheDocument();
    for (const label of ["Configuration", "Repos", "Directives", "Doc profiles"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the active section with aria-current", () => {
    render(<SettingsTree active="directives" onSelect={vi.fn<(section: string) => void>()} />);
    expect(screen.getByRole("button", { name: "Directives" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Repos" })).not.toHaveAttribute("aria-current");
  });

  it("reports the chosen section", () => {
    const onSelect = vi.fn<(section: string) => void>();
    render(<SettingsTree active="configuration" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Doc profiles" }));
    expect(onSelect).toHaveBeenCalledWith("doc-profiles");
  });
});
