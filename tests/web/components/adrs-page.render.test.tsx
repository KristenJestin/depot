// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { AdrListView, AdrDetailView } from "#/web/components/adrs-page";

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

describe("AdrListView", () => {
  it("renders the ADR numbers, titles, and statuses", () => {
    render(
      <AdrListView
        projectId="proj-1"
        items={[
          {
            id: "adr-a",
            projectId: "proj-1",
            prdId: null,
            number: 1,
            title: "First decision",
            status: "accepted",
            body: "",
            supersededByAdrId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "adr-b",
            projectId: "proj-1",
            prdId: "prd-1",
            number: 2,
            title: "Second decision",
            status: "proposed",
            body: "",
            supersededByAdrId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    expect(screen.getByText("ADR-0001")).toBeInTheDocument();
    expect(screen.getByText("ADR-0002")).toBeInTheDocument();
    expect(screen.getByText("First decision")).toBeInTheDocument();
    expect(screen.getByText("Second decision")).toBeInTheDocument();
    expect(screen.getByText("accepted")).toBeInTheDocument();
    expect(screen.getByText("proposed")).toBeInTheDocument();
  });

  it("shows an empty state when the list is empty", () => {
    render(<AdrListView projectId="proj-1" items={[]} />);
    expect(screen.getByText(/no adrs/i)).toBeInTheDocument();
  });

  it("does not render any create / edit / accept / supersede buttons", () => {
    render(
      <AdrListView
        projectId="proj-1"
        items={[
          {
            id: "adr-a",
            projectId: "proj-1",
            prdId: null,
            number: 1,
            title: "First decision",
            status: "accepted",
            body: "",
            supersededByAdrId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /create|new adr|edit|accept|supersede/i }),
    ).toBeNull();
  });
});

describe("AdrDetailView", () => {
  const baseAdr = {
    id: "adr-1",
    projectId: "proj-1",
    prdId: "prd-1",
    number: 1,
    title: "Use SQLite",
    status: "accepted" as const,
    body: "# Context\n\nWe pick SQLite.",
    supersededByAdrId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("renders the markdown body, title and status", () => {
    render(<AdrDetailView adr={baseAdr} supersededBy={null} supersedes={null} />);

    expect(screen.getByText("Use SQLite")).toBeInTheDocument();
    expect(screen.getByText("accepted")).toBeInTheDocument();
    // Markdown heading rendered as <h1>
    expect(screen.getByRole("heading", { name: "Context" })).toBeInTheDocument();
    expect(screen.getByText(/We pick SQLite/i)).toBeInTheDocument();
  });

  it("links to the source PRD when prdId is set", () => {
    render(<AdrDetailView adr={baseAdr} supersededBy={null} supersedes={null} />);

    const prdLink = screen.getByRole("link", { name: /prd source/i });
    expect(prdLink.getAttribute("data-to")).toBe("/prds/$id");
  });

  it("does not render a PRD source link when prdId is null", () => {
    render(
      <AdrDetailView adr={{ ...baseAdr, prdId: null }} supersededBy={null} supersedes={null} />,
    );
    expect(screen.queryByRole("link", { name: /prd source/i })).toBeNull();
  });

  it("renders 'superseded by' and 'supersedes' links when present", () => {
    render(
      <AdrDetailView
        adr={baseAdr}
        supersededBy={{ ...baseAdr, id: "adr-2", number: 2, title: "Better decision" }}
        supersedes={{ ...baseAdr, id: "adr-0", number: 0, title: "Older decision" }}
      />,
    );

    expect(screen.getByText(/superseded by/i)).toBeInTheDocument();
    expect(screen.getByText("Better decision")).toBeInTheDocument();
    expect(screen.getByText(/supersedes/i)).toBeInTheDocument();
    expect(screen.getByText("Older decision")).toBeInTheDocument();
  });

  it("does not render any mutation buttons", () => {
    render(<AdrDetailView adr={baseAdr} supersededBy={null} supersedes={null} />);
    expect(
      screen.queryByRole("button", { name: /edit|accept|supersede|create|new adr/i }),
    ).toBeNull();
  });
});
