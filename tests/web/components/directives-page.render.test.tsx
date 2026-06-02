// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  DirectivesTable,
  DirectiveDetailView,
  filterAndSortDirectives,
  ANY,
  type DirectiveRow,
  type FilterState,
} from "#/web/components/directives-page";

const NO_FILTER: FilterState = {
  category: ANY,
  scope: ANY,
  kind: ANY,
  repoTarget: ANY,
  enabled: ANY,
};

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
    params: _params,
    ...props
  }: {
    children?: React.ReactNode;
    className?: string;
    to?: string;
    params?: unknown;
  } & Record<string, unknown>) => (
    <a href={to ?? "#"} className={className} data-to={to} {...props}>
      {children}
    </a>
  ),
}));

function makeDirective(overrides: Partial<DirectiveRow> = {}): DirectiveRow {
  return {
    id: "d-1",
    projectId: "proj-1",
    category: "dev",
    scope: "pre-review",
    title: "Format code",
    instruction: "bun run format",
    kind: "command",
    repoTarget: "auto",
    blocking: true,
    position: 0,
    enabled: true,
    lastRunAt: null,
    lastRunStatus: null,
    ...overrides,
  };
}

describe("DirectivesTable", () => {
  const items: DirectiveRow[] = [
    makeDirective({ id: "d-1", title: "Format code", category: "dev", repoTarget: "api" }),
    makeDirective({
      id: "d-2",
      title: "Lint api",
      category: "auditor",
      scope: "always",
      repoTarget: "api",
      kind: "rule",
    }),
    makeDirective({
      id: "d-3",
      title: "Build front",
      category: "dev",
      scope: "pre-ship",
      repoTarget: "front",
      lastRunStatus: "ok",
    }),
  ];

  it("renders one row per directive with the repoTarget column visible", () => {
    render(<DirectivesTable projectId="proj-1" items={items} />);
    const table = screen.getByTestId("directives-table");
    // The repo target dimension is a column header.
    expect(within(table).getByRole("columnheader", { name: "Repo target" })).toBeInTheDocument();
    expect(within(table).getByText("Format code")).toBeInTheDocument();
    expect(within(table).getByText("Lint api")).toBeInTheDocument();
    expect(within(table).getByText("Build front")).toBeInTheDocument();
    // repoTarget rendered for each row (two `api`, one `front`)
    expect(within(table).getAllByText("api")).toHaveLength(2);
    expect(within(table).getByText("front")).toBeInTheDocument();
    // Filter controls expose the repoTarget dimension as well.
    expect(screen.getByLabelText("Filter by repo target")).toBeInTheDocument();
  });

  it("links each title to the directive drill-in route", () => {
    render(<DirectivesTable projectId="proj-1" items={items} />);
    const link = screen.getByRole("link", { name: "Format code" });
    expect(link.getAttribute("data-to")).toBe("/projects/$id/directives/$directiveId");
  });

  it("filtering by category reduces the rows", () => {
    const byCategory = filterAndSortDirectives(
      items,
      { ...NO_FILTER, category: "auditor" },
      "position",
    );
    expect(byCategory.map((d) => d.id)).toEqual(["d-2"]);
    // Unfiltered keeps every row.
    expect(filterAndSortDirectives(items, NO_FILTER, "position")).toHaveLength(3);
  });

  it("filtering by repoTarget reduces the rows", () => {
    const front = filterAndSortDirectives(items, { ...NO_FILTER, repoTarget: "front" }, "position");
    expect(front.map((d) => d.id)).toEqual(["d-3"]);
    const api = filterAndSortDirectives(items, { ...NO_FILTER, repoTarget: "api" }, "position");
    expect(api.map((d) => d.id).sort()).toEqual(["d-1", "d-2"]);
  });

  it("filtering by enabled and kind narrows the rows", () => {
    const withDisabled = [
      ...items,
      makeDirective({ id: "d-4", title: "Off rule", enabled: false, kind: "rule" }),
    ];
    expect(
      filterAndSortDirectives(withDisabled, { ...NO_FILTER, enabled: "disabled" }, "position").map(
        (d) => d.id,
      ),
    ).toEqual(["d-4"]);
    expect(
      filterAndSortDirectives(withDisabled, { ...NO_FILTER, kind: "command" }, "position").every(
        (d) => d.kind === "command",
      ),
    ).toBe(true);
  });

  it("sorts by category then scope then position", () => {
    const byScope = filterAndSortDirectives(items, NO_FILTER, "scope");
    expect(byScope.map((d) => d.scope)).toEqual(["always", "pre-review", "pre-ship"]);
    const byCategory = filterAndSortDirectives(items, NO_FILTER, "category");
    expect(byCategory[0]!.category).toBe("auditor");
  });

  it("paginates at 50 rows per page", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      makeDirective({ id: `d-${i}`, title: `Directive ${i}`, position: i }),
    );
    render(<DirectivesTable projectId="proj-1" items={many} />);
    const table = screen.getByTestId("directives-table");
    // First page shows the first 50 (Directive 0..49), not Directive 50.
    expect(within(table).getByText("Directive 0")).toBeInTheDocument();
    expect(within(table).getByText("Directive 49")).toBeInTheDocument();
    expect(within(table).queryByText("Directive 50")).toBeNull();
    expect(screen.getByText("Page 1 / 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(within(table).getByText("Directive 50")).toBeInTheDocument();
    expect(within(table).queryByText("Directive 0")).toBeNull();
  });

  it("shows an empty state when there are no directives", () => {
    render(<DirectivesTable projectId="proj-1" items={[]} />);
    expect(screen.getByText(/no directives yet/i)).toBeInTheDocument();
  });
});

describe("DirectiveDetailView", () => {
  it("renders the full instruction, last-run status and metadata", () => {
    render(
      <DirectiveDetailView
        directive={makeDirective({
          instruction: "bun run format --all",
          lastRunStatus: "fail",
          lastRunOutput: "STDOUT:\nboom\nSTDERR:\n",
          position: 3,
          createdAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-02T10:00:00.000Z",
        })}
      />,
    );

    const detail = screen.getByTestId("directive-detail");
    expect(within(detail).getByText("Format code")).toBeInTheDocument();
    // Full instruction is shown (the table only showed the title).
    expect(within(detail).getByText("bun run format --all")).toBeInTheDocument();
    // Last-run status + captured output.
    expect(within(detail).getByText("fail")).toBeInTheDocument();
    expect(within(detail).getByText(/boom/)).toBeInTheDocument();
    // Position + repo target are surfaced.
    expect(within(detail).getByText("3")).toBeInTheDocument();
    expect(within(detail).getByText("auto")).toBeInTheDocument();
  });

  it("wires Enable/Disable, Run, Edit and Remove actions", () => {
    const onToggle = vi.fn<() => void>();
    const onRun = vi.fn<() => void>();
    const onEdit = vi.fn<() => void>();
    const onRemove = vi.fn<() => void>();
    render(
      <DirectiveDetailView
        directive={makeDirective({ enabled: true, kind: "command" })}
        onToggleEnabled={onToggle}
        onRun={onRun}
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("hides the Run action for rule directives", () => {
    render(
      <DirectiveDetailView
        directive={makeDirective({ kind: "rule" })}
        onRun={vi.fn<() => void>()}
        onEdit={vi.fn<() => void>()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });
});
