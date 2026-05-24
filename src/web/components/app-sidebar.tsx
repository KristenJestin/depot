import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CogIcon,
  FileTextIcon,
  FolderOpenIcon,
  FoldersIcon,
  LayoutDashboardIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
} from "lucide-react";

import { cn } from "#/web/lib/utils";
import { usePersistedState } from "#/web/lib/use-persisted-state";
import { contextQuery, prdsQuery, switchWorkspace, workspacesQuery } from "#/web/lib/queries";
import { PrdStatusIcon } from "#/web/components/prd-status-icon";
import type { PrdListResponse, Workspace } from "#/web/lib/api-types";

const COLLAPSED_STORAGE_KEY = "depot.sidebar.collapsed";

type SidebarPrd = PrdListResponse["prds"][number];

function workspaceDisplayName(ws: Workspace): string {
  if (ws.label) return ws.label;
  const parts = ws.path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || ws.path;
}

/**
 * Resolves the project the user is currently focused on. PRD detail routes
 * carry a `projectId` on the loaded PRD; project routes expose it as a path
 * param; the dashboard derives it from the selected workspace.
 */
function useActiveProjectId(): string | null {
  const params = useRouterState({ select: (s) => s.matches.at(-1)?.params }) as
    | { id?: string }
    | undefined;
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: prdsData } = useQuery(prdsQuery.list.options());
  const { data: contextData } = useQuery(contextQuery.options());
  const { data: wsData } = useQuery(workspacesQuery.options());

  if (pathname.startsWith("/projects/") && params?.id) return params.id;
  if (pathname.startsWith("/prds/") && params?.id) {
    const prd = prdsData?.prds.find((p) => p.id === params.id);
    if (prd) return prd.projectId;
  }
  const currentWs = wsData?.workspaces.find((w) => w.id === contextData?.workspaceId);
  return currentWs?.projectId ?? null;
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const queryClientInstance = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const { data: contextData } = useQuery(contextQuery.options());
  const { data: wsData } = useQuery(workspacesQuery.options());

  // Orphan workspaces (folder removed on disk) are filtered out by the
  // /api/workspaces endpoint by default; this client-side guard mirrors
  // the same rule so the switcher never offers an orphan even if a
  // caller (or future opt-in) hands us one with `isOrphan: true`.
  const workspaces = (wsData?.workspaces ?? []).filter((w) => !w.isOrphan);
  const currentId = contextData?.workspaceId ?? null;
  const current = workspaces.find((w) => w.id === currentId);

  const mutation = useMutation({
    mutationFn: switchWorkspace,
    onSuccess: () => queryClientInstance.invalidateQueries(),
  });

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (workspaces.length === 0) return null;

  // currentId === null means the user explicitly picked "All projects" via
  // the dedicated entry below. Distinct from "no workspace" (which would be
  // the initial state when the cwd hint resolves to nothing).
  const isAllProjects = contextData !== undefined && currentId === null;
  const label = isAllProjects
    ? "All projects"
    : current
      ? workspaceDisplayName(current)
      : "No workspace";
  const projectName = isAllProjects ? "Across every project" : (current?.projectName ?? null);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch workspace"
        title={collapsed ? label : undefined}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-lg border border-transparent text-left transition-colors",
          collapsed ? "justify-center px-0" : "px-2.5",
          "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          "focus-visible:border-sidebar-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/20",
        )}
      >
        <FolderOpenIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-sidebar-accent-foreground">
                {label}
              </div>
              {projectName && (
                <div className="truncate text-xs text-sidebar-foreground/65">{projectName}</div>
              )}
            </div>
            <ChevronsUpDownIcon className="size-3.5 shrink-0 text-sidebar-foreground/50" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 min-w-56 overflow-hidden rounded-xl border border-card-border bg-popover p-1 shadow-card-hover">
          <div className="max-h-60 overflow-y-auto">
            {/* "All projects" pseudo-entry — sets workspaceId to null so the
                middleware's cleared-sentinel branch fires and GET /api/prds
                returns every project. The BoardCard shows a project badge
                in this mode (see KanbanCard). */}
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                mutation.mutate(null);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                isAllProjects
                  ? "bg-accent text-accent-foreground"
                  : "text-popover-foreground hover:bg-accent",
              )}
            >
              <CheckIcon
                className={cn("size-3 shrink-0", isAllProjects ? "opacity-100" : "opacity-0")}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">All projects</div>
                <div className="truncate text-xs text-muted-foreground">
                  Show every PRD with project badges
                </div>
              </div>
            </button>
            <div className="my-1 border-t border-card-border" />
            {workspaces.map((ws) => {
              const isSelected = ws.id === currentId;
              return (
                <button
                  key={ws.id}
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => {
                    mutation.mutate(ws.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "text-popover-foreground hover:bg-accent",
                  )}
                >
                  <CheckIcon
                    className={cn("size-3 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{workspaceDisplayName(ws)}</div>
                    <div className="truncate text-xs text-muted-foreground">{ws.projectName}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarSection({
  title,
  collapsed,
  children,
}: {
  title: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      {!collapsed && <p className="px-3 text-xs font-medium text-sidebar-foreground/65">{title}</p>}
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SidebarLink({
  to,
  params,
  label,
  icon: Icon,
  exact,
  collapsed,
}: {
  to: string;
  params?: Record<string, string>;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      to={to}
      params={params}
      activeOptions={{ exact }}
      title={collapsed ? label : undefined}
      className="block no-underline"
    >
      {({ isActive }) => (
        <div
          className={cn(
            "flex h-8 items-center gap-2 rounded-lg border border-transparent text-sm font-medium transition-colors",
            collapsed ? "justify-center px-0" : "px-3",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className="size-4 shrink-0" />
          {!collapsed && <span className="truncate">{label}</span>}
        </div>
      )}
    </Link>
  );
}

function SidebarPrdLink({ prd, collapsed }: { prd: SidebarPrd; collapsed: boolean }) {
  return (
    <Link
      to="/prds/$id"
      params={{ id: prd.id }}
      aria-label={`Open ${prd.title}`}
      title={collapsed ? prd.title : undefined}
      className="block no-underline"
    >
      {({ isActive }) => (
        <div
          className={cn(
            "flex min-h-9 items-center gap-2 rounded-lg border border-transparent text-sm transition-colors",
            collapsed ? "justify-center px-0 py-1.5" : "px-3 py-1.5",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <PrdStatusIcon status={prd.status} className="size-4 shrink-0" />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{prd.title}</span>}
        </div>
      )}
    </Link>
  );
}

/**
 * Reusable left navigation for the app shell. Lists known PRDs, highlights the
 * active project, exposes contextual sub-nav for that project, and a "new
 * project" entry at the bottom. Collapsible; the collapsed/expanded preference
 * persists in `localStorage`.
 */
export function AppSidebar() {
  const [collapsed, setCollapsed] = usePersistedState(COLLAPSED_STORAGE_KEY, false);

  const { data } = useQuery(prdsQuery.list.options());
  const prds = React.useMemo(
    () =>
      [...(data?.prds ?? [])].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [data?.prds],
  );

  const activeProjectId = useActiveProjectId();

  return (
    <aside
      data-collapsed={collapsed ? "" : undefined}
      className={cn(
        "hidden shrink-0 flex-col overflow-hidden p-2 transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex items-center gap-1 px-1 py-1">
        <Link
          to="/"
          aria-label="depot home"
          className={cn(
            "flex h-10 min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent",
            collapsed ? "flex-1 justify-center px-0" : "flex-1",
          )}
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg depot-logo-gradient text-xs font-semibold text-primary-foreground shadow-card">
            D
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight">depot</div>
              <div className="truncate text-xs leading-tight text-sidebar-foreground/70">
                PRD workspace
              </div>
            </div>
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/20"
          >
            <PanelLeftCloseIcon className="size-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <div className="px-1 pb-1">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="flex h-8 w-full items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/20"
          >
            <PanelLeftOpenIcon className="size-4" />
          </button>
        </div>
      )}

      <div className="px-1 pb-3 pt-2">
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        <div className="space-y-6">
          <SidebarSection title="Navigation" collapsed={collapsed}>
            <SidebarLink
              to="/"
              label="Overview"
              icon={LayoutDashboardIcon}
              exact
              collapsed={collapsed}
            />
            <SidebarLink to="/projects" label="Projects" icon={FoldersIcon} collapsed={collapsed} />
          </SidebarSection>

          {activeProjectId && (
            <SidebarSection title="This project" collapsed={collapsed}>
              <SidebarLink
                to="/projects/$id/docs"
                params={{ id: activeProjectId }}
                label="Docs"
                icon={FileTextIcon}
                collapsed={collapsed}
              />
              <SidebarLink
                to="/projects/$id/adrs"
                params={{ id: activeProjectId }}
                label="ADRs"
                icon={BookOpenIcon}
                collapsed={collapsed}
              />
              <SidebarLink
                to="/projects/$id/settings"
                params={{ id: activeProjectId }}
                label="Settings"
                icon={CogIcon}
                collapsed={collapsed}
              />
            </SidebarSection>
          )}

          {prds.length > 0 ? (
            <SidebarSection title="PRDs" collapsed={collapsed}>
              {prds.map((prd) => (
                <SidebarPrdLink key={prd.id} prd={prd} collapsed={collapsed} />
              ))}
            </SidebarSection>
          ) : null}
        </div>
      </nav>

      <div className="mt-auto space-y-1 border-t border-sidebar-border px-1 pb-1 pt-2">
        <SidebarLink to="/projects" label="New project" icon={PlusIcon} collapsed={collapsed} />
        {!collapsed && (
          <div className="flex items-center justify-between gap-2 px-3 py-1 text-xs text-sidebar-foreground/70">
            <span className="font-mono">v0.1.0</span>
            <span>serve</span>
          </div>
        )}
      </div>
    </aside>
  );
}
