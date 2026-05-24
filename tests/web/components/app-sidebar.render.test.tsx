// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * Render tests for the `app-shell` global layout (PRD 14, Phase 2): the
 * `<AppSidebar>` lists known PRDs, highlights the active project with a
 * contextual sub-nav, exposes a "new project" entry, and persists its
 * collapsed state to `localStorage`.
 */

let pathname = "/";
let lastMatchParams: Record<string, string> = {};

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({
      location: { pathname },
      matches: [{ params: lastMatchParams }],
    }),
  Link: ({
    children,
    className,
    to,
    params: _params,
    activeOptions: _activeOptions,
    ...props
  }: {
    children?: React.ReactNode | ((state: { isActive: boolean }) => React.ReactNode);
    className?: string;
    to?: string;
    params?: unknown;
    activeOptions?: unknown;
  } & Record<string, unknown>) => (
    <a href={to ?? "#"} className={className} data-to={to} {...props}>
      {typeof children === "function" ? children({ isActive: false }) : children}
    </a>
  ),
}));

const PRDS = {
  prds: [
    {
      id: "prd-alpha",
      projectId: "proj-1",
      projectName: "Acme",
      title: "Alpha PRD",
      status: "in_progress" as const,
      updatedAt: "2026-05-01T10:00:00.000Z",
    },
    {
      id: "prd-beta",
      projectId: "proj-1",
      projectName: "Acme",
      title: "Beta PRD",
      status: "draft" as const,
      updatedAt: "2026-05-02T10:00:00.000Z",
    },
  ],
};

type MockWorkspace = {
  id: string;
  path: string;
  label: string | null;
  projectId: string;
  projectName: string;
  isOrphan?: boolean;
};

let mockWorkspaces: MockWorkspace[] = [
  {
    id: "ws-1",
    path: "/home/u/acme",
    label: "acme",
    projectId: "proj-1",
    projectName: "Acme",
  },
];

vi.mock("#/web/lib/queries", () => ({
  prdsQuery: { list: { options: () => ({ queryKey: ["prds"] }) } },
  contextQuery: { options: () => ({ queryKey: ["context"] }) },
  workspacesQuery: { options: () => ({ queryKey: ["workspaces"] }) },
  switchWorkspace: vi.fn<() => void>(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "prds") return { data: PRDS };
    if (queryKey[0] === "context") return { data: { workspaceId: "ws-1" } };
    if (queryKey[0] === "workspaces") return { data: { workspaces: mockWorkspaces } };
    return { data: undefined };
  },
  useMutation: () => ({ mutate: vi.fn<() => void>(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn<() => void>() }),
}));

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

async function renderSidebar() {
  const { AppSidebar } = await import("#/web/components/app-sidebar");
  return render(<AppSidebar />);
}

describe("AppSidebar", () => {
  beforeEach(() => {
    pathname = "/";
    lastMatchParams = {};
    mockWorkspaces = [
      {
        id: "ws-1",
        path: "/home/u/acme",
        label: "acme",
        projectId: "proj-1",
        projectName: "Acme",
      },
    ];
    installLocalStorage();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("lists known PRDs and exposes the navigation + new project entries", async () => {
    await renderSidebar();

    expect(screen.getByText("Alpha PRD")).toBeInTheDocument();
    expect(screen.getByText("Beta PRD")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();
  });

  it("shows the contextual project sub-nav when a project is active", async () => {
    pathname = "/projects/proj-1/settings";
    lastMatchParams = { id: "proj-1" };
    await renderSidebar();

    expect(screen.getByText("This project")).toBeInTheDocument();
    const docsLink = screen.getByText("Docs").closest("a");
    expect(docsLink?.getAttribute("data-to")).toBe("/projects/$id/docs");
    expect(screen.getByText("Settings").closest("a")?.getAttribute("data-to")).toBe(
      "/projects/$id/settings",
    );
  });

  it("derives the active project from the open PRD on a /prds route", async () => {
    pathname = "/prds/prd-alpha";
    lastMatchParams = { id: "prd-alpha" };
    await renderSidebar();

    expect(screen.getByText("This project")).toBeInTheDocument();
  });

  it("collapses and expands, persisting the state to localStorage", async () => {
    await renderSidebar();

    expect(screen.getByText("depot")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.queryByText("depot")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("depot.sidebar.collapsed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(screen.getByText("depot")).toBeInTheDocument();
    expect(window.localStorage.getItem("depot.sidebar.collapsed")).toBe("false");
  });

  it("starts collapsed when localStorage already holds the collapsed preference", async () => {
    window.localStorage.setItem("depot.sidebar.collapsed", "true");
    await renderSidebar();

    expect(screen.queryByText("depot")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("renders the workspace switcher with the active workspace label", async () => {
    await renderSidebar();

    const switcher = screen.getByRole("button", { name: "Switch workspace" });
    expect(within(switcher).getByText("acme")).toBeInTheDocument();
  });

  it("never lists workspaces flagged as orphan in the switcher dropdown", async () => {
    mockWorkspaces = [
      {
        id: "ws-1",
        path: "/home/u/acme",
        label: "acme",
        projectId: "proj-1",
        projectName: "Acme",
        isOrphan: false,
      },
      {
        id: "ws-2",
        path: "/home/u/ghost",
        label: "ghost-orphan",
        projectId: "proj-1",
        projectName: "Acme",
        isOrphan: true,
      },
    ];

    await renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    expect(screen.getAllByText("acme").length).toBeGreaterThan(0);
    expect(screen.queryByText("ghost-orphan")).not.toBeInTheDocument();
  });
});
