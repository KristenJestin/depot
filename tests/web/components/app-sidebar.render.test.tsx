// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * Render tests for the `app-shell` global layout (PRD 14, Phase 2 + PRD 0021
 * T2/T3): the `<AppSidebar>` lists known PRDs ordered by status
 * (review → in_progress → ready → draft, `done`/`canceled` in a collapsible
 * "Archives" section), highlights the active project with a contextual sub-nav,
 * exposes a "new project" entry, and persists its collapsed state to
 * `localStorage`. The project switcher lists **projects** (not workspaces).
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

type MockPrd = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: "draft" | "ready" | "in_progress" | "review" | "done" | "canceled";
  updatedAt: string;
};

let mockPrds: MockPrd[] = [
  {
    id: "prd-alpha",
    projectId: "proj-1",
    projectName: "Acme",
    title: "Alpha PRD",
    status: "in_progress",
    updatedAt: "2026-05-01T10:00:00.000Z",
  },
  {
    id: "prd-beta",
    projectId: "proj-1",
    projectName: "Acme",
    title: "Beta PRD",
    status: "draft",
    updatedAt: "2026-05-02T10:00:00.000Z",
  },
];

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

type MockProject = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  prdCount: number;
  workspaceCount: number;
  docCount: number;
  directiveCount: number;
};

let mockProjects: MockProject[] = [
  {
    id: "proj-1",
    name: "Acme",
    description: null,
    status: "active",
    prdCount: 2,
    workspaceCount: 1,
    docCount: 0,
    directiveCount: 0,
  },
];

vi.mock("#/web/lib/queries", () => ({
  prdsQuery: { list: { options: () => ({ queryKey: ["prds"] }) } },
  contextQuery: { options: () => ({ queryKey: ["context"] }) },
  workspacesQuery: { options: () => ({ queryKey: ["workspaces"] }) },
  projectsQuery: { options: () => ({ queryKey: ["projects"] }) },
  switchWorkspace: vi.fn<() => void>(),
}));

const mutate = vi.fn<(id: string | null) => void>();

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "prds") return { data: { prds: mockPrds } };
    if (queryKey[0] === "context") return { data: { workspaceId: "ws-1" } };
    if (queryKey[0] === "workspaces") return { data: { workspaces: mockWorkspaces } };
    if (queryKey[0] === "projects") return { data: { items: mockProjects } };
    return { data: undefined };
  },
  useMutation: ({ mutationFn }: { mutationFn: (id: string | null) => void }) => ({
    mutate: (id: string | null) => {
      mutationFn(id);
      mutate(id);
    },
    isPending: false,
  }),
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
    mutate.mockClear();
    mockPrds = [
      {
        id: "prd-alpha",
        projectId: "proj-1",
        projectName: "Acme",
        title: "Alpha PRD",
        status: "in_progress",
        updatedAt: "2026-05-01T10:00:00.000Z",
      },
      {
        id: "prd-beta",
        projectId: "proj-1",
        projectName: "Acme",
        title: "Beta PRD",
        status: "draft",
        updatedAt: "2026-05-02T10:00:00.000Z",
      },
    ];
    mockWorkspaces = [
      {
        id: "ws-1",
        path: "/home/u/acme",
        label: "acme",
        projectId: "proj-1",
        projectName: "Acme",
      },
    ];
    mockProjects = [
      {
        id: "proj-1",
        name: "Acme",
        description: null,
        status: "active",
        prdCount: 2,
        workspaceCount: 1,
        docCount: 0,
        directiveCount: 0,
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

  // ── T2: PRD ordering + Archives ────────────────────────────────────────────

  it("orders active PRDs review → in_progress → ready → draft", async () => {
    mockPrds = [
      {
        id: "prd-draft",
        projectId: "proj-1",
        projectName: "Acme",
        title: "Draft One",
        status: "draft",
        updatedAt: "2026-05-10T10:00:00.000Z",
      },
      {
        id: "prd-ready",
        projectId: "proj-1",
        projectName: "Acme",
        title: "Ready One",
        status: "ready",
        updatedAt: "2026-05-09T10:00:00.000Z",
      },
      {
        id: "prd-inprog",
        projectId: "proj-1",
        projectName: "Acme",
        title: "In Progress One",
        status: "in_progress",
        updatedAt: "2026-05-08T10:00:00.000Z",
      },
      {
        id: "prd-review",
        projectId: "proj-1",
        projectName: "Acme",
        title: "Review One",
        status: "review",
        updatedAt: "2026-05-07T10:00:00.000Z",
      },
    ];

    await renderSidebar();

    const links = screen.getAllByRole("link", { name: /Open / });
    const titles = links.map((l) => l.getAttribute("aria-label"));
    expect(titles).toEqual([
      "Open Review One",
      "Open In Progress One",
      "Open Ready One",
      "Open Draft One",
    ]);
  });

  it("sub-sorts each status group by updatedAt desc", async () => {
    mockPrds = [
      {
        id: "ip-old",
        projectId: "proj-1",
        projectName: "Acme",
        title: "InProg Old",
        status: "in_progress",
        updatedAt: "2026-05-01T10:00:00.000Z",
      },
      {
        id: "ip-new",
        projectId: "proj-1",
        projectName: "Acme",
        title: "InProg New",
        status: "in_progress",
        updatedAt: "2026-05-20T10:00:00.000Z",
      },
    ];

    await renderSidebar();

    const links = screen.getAllByRole("link", { name: /Open InProg/ });
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Open InProg New",
      "Open InProg Old",
    ]);
  });

  it("hides done/canceled PRDs behind a collapsible Archives section with a count", async () => {
    mockPrds = [
      {
        id: "prd-active",
        projectId: "proj-1",
        projectName: "Acme",
        title: "Active PRD",
        status: "in_progress",
        updatedAt: "2026-05-05T10:00:00.000Z",
      },
      {
        id: "prd-done",
        projectId: "proj-1",
        projectName: "Acme",
        title: "Done PRD",
        status: "done",
        updatedAt: "2026-05-04T10:00:00.000Z",
      },
      {
        id: "prd-canceled",
        projectId: "proj-1",
        projectName: "Acme",
        title: "Canceled PRD",
        status: "canceled",
        updatedAt: "2026-05-03T10:00:00.000Z",
      },
    ];

    await renderSidebar();

    // Active PRD visible; archived ones hidden until the section is expanded.
    expect(screen.getByText("Active PRD")).toBeInTheDocument();
    expect(screen.queryByText("Done PRD")).not.toBeInTheDocument();
    expect(screen.queryByText("Canceled PRD")).not.toBeInTheDocument();

    const archives = screen.getByRole("button", { name: "Archives (2)" });
    expect(within(archives).getByText("2")).toBeInTheDocument();
    expect(archives.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(archives);

    expect(screen.getByText("Done PRD")).toBeInTheDocument();
    expect(screen.getByText("Canceled PRD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archives (2)" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("renders no Archives section when there are no done/canceled PRDs", async () => {
    await renderSidebar();
    expect(screen.queryByRole("button", { name: /Archives/ })).not.toBeInTheDocument();
  });

  // ── T3: project switcher lists projects, not workspaces ─────────────────────

  it("renders the project switcher with the active project name", async () => {
    await renderSidebar();

    const switcher = screen.getByRole("button", { name: "Switch project" });
    expect(within(switcher).getByText("Acme")).toBeInTheDocument();
  });

  it("lists only project names in the switcher — never workspace labels", async () => {
    // Distinct projects AND workspaces: a single project owning several
    // workspaces whose labels look like `mails-m365-xx`. The switcher must
    // surface the project name (`Acme`), never the workspace labels.
    mockProjects = [
      {
        id: "proj-1",
        name: "Acme",
        description: null,
        status: "active",
        prdCount: 2,
        workspaceCount: 2,
        docCount: 0,
        directiveCount: 0,
      },
      {
        id: "proj-2",
        name: "nyx",
        description: null,
        status: "active",
        prdCount: 1,
        workspaceCount: 1,
        docCount: 0,
        directiveCount: 0,
      },
    ];
    mockWorkspaces = [
      {
        id: "ws-1",
        path: "/home/u/mails-m365-01",
        label: "mails-m365-01",
        projectId: "proj-1",
        projectName: "Acme",
      },
      {
        id: "ws-2",
        path: "/home/u/mails-m365-02",
        label: "mails-m365-02",
        projectId: "proj-1",
        projectName: "Acme",
      },
      {
        id: "ws-3",
        path: "/home/u/nyx-main",
        label: "nyx-main",
        projectId: "proj-2",
        projectName: "nyx",
      },
    ];

    await renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));

    // Project names appear (in the trigger and/or the menu).
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(screen.getByText("nyx")).toBeInTheDocument();

    // No workspace label leaks into the selector.
    expect(screen.queryByText("mails-m365-01")).not.toBeInTheDocument();
    expect(screen.queryByText("mails-m365-02")).not.toBeInTheDocument();
    expect(screen.queryByText("nyx-main")).not.toBeInTheDocument();
  });

  it("switches the workspace context to a representative workspace when a project is picked", async () => {
    mockProjects = [
      {
        id: "proj-1",
        name: "Acme",
        description: null,
        status: "active",
        prdCount: 2,
        workspaceCount: 1,
        docCount: 0,
        directiveCount: 0,
      },
      {
        id: "proj-2",
        name: "nyx",
        description: null,
        status: "active",
        prdCount: 1,
        workspaceCount: 1,
        docCount: 0,
        directiveCount: 0,
      },
    ];
    mockWorkspaces = [
      {
        id: "ws-1",
        path: "/home/u/acme",
        label: "acme",
        projectId: "proj-1",
        projectName: "Acme",
      },
      {
        id: "ws-pal",
        path: "/home/u/nyx",
        label: "nyx",
        projectId: "proj-2",
        projectName: "nyx",
      },
    ];

    await renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
    fireEvent.click(screen.getByText("nyx"));

    // Picking the project switches to that project's representative workspace.
    expect(mutate).toHaveBeenCalledWith("ws-pal");
  });

  it("offers an All projects entry that clears the workspace scope", async () => {
    await renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
    fireEvent.click(screen.getByText("Show every PRD with project badges"));

    expect(mutate).toHaveBeenCalledWith(null);
  });

  it("never offers a project whose only workspace is an orphan", async () => {
    mockProjects = [
      {
        id: "proj-1",
        name: "Acme",
        description: null,
        status: "active",
        prdCount: 2,
        workspaceCount: 1,
        docCount: 0,
        directiveCount: 0,
      },
      {
        id: "proj-ghost",
        name: "GhostProject",
        description: null,
        status: "active",
        prdCount: 0,
        workspaceCount: 1,
        docCount: 0,
        directiveCount: 0,
      },
    ];
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
        id: "ws-ghost",
        path: "/home/u/ghost",
        label: "ghost",
        projectId: "proj-ghost",
        projectName: "GhostProject",
        isOrphan: true,
      },
    ];

    await renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));

    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(screen.queryByText("GhostProject")).not.toBeInTheDocument();
  });
});
