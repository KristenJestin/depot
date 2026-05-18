import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, FolderOpenIcon, LayoutDashboardIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { contextQuery, prdsQuery, switchWorkspace, workspacesQuery } from "../lib/queries";
import { PrdStatusIcon } from "./prd-status-icon";
import type { PrdListResponse, Workspace } from "../lib/api-types";

type SidebarPrd = PrdListResponse["prds"][number];

function workspaceDisplayName(ws: Workspace): string {
  if (ws.label) return ws.label;
  const parts = ws.path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || ws.path;
}

function WorkspaceSwitcher() {
  const queryClientInstance = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const { data: contextData } = useQuery(contextQuery.options());
  const { data: wsData } = useQuery(workspacesQuery.options());

  const workspaces = wsData?.workspaces ?? [];
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
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-lg border border-transparent px-2.5 text-left transition-colors",
          "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          "focus-visible:border-sidebar-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/20",
        )}
      >
        <FolderOpenIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-sidebar-accent-foreground">{label}</div>
          {projectName && (
            <div className="truncate text-xs text-sidebar-foreground/65">{projectName}</div>
          )}
        </div>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-sidebar-foreground/50" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-card-border bg-popover p-1 shadow-card-hover">
          <div className="max-h-60 overflow-y-auto">
            {/* "All projects" pseudo-entry — sets workspaceId to null so the
                middleware's cleared-sentinel branch fires and GET /api/prds
                returns every project. The BoardCard shows a project badge
                in this mode (see KanbanCard). */}
            <button
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data } = useQuery(prdsQuery.list.options());
  const prds = React.useMemo(
    () =>
      [...(data?.prds ?? [])].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [data?.prds],
  );

  return (
    <div className="relative flex h-dvh overflow-hidden bg-sidebar text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col overflow-hidden p-2 md:flex">
        <div className="px-1 py-1">
          <Link
            to="/"
            className="flex h-10 items-center gap-2 rounded-lg border border-transparent px-2 text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg depot-logo-gradient text-xs font-semibold text-primary-foreground shadow-card">
              D
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight">depot</div>
              <div className="truncate text-xs leading-tight text-sidebar-foreground/70">
                PRD workspace
              </div>
            </div>
          </Link>
        </div>

        <div className="px-1 pb-3 pt-2">
          <WorkspaceSwitcher />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          <div className="space-y-6">
            <SidebarSection title="Navigation">
              <SidebarLink to="/" label="Overview" icon={LayoutDashboardIcon} exact />
            </SidebarSection>

            {prds.length > 0 ? (
              <SidebarSection title="PRDs">
                {prds.map((prd) => (
                  <SidebarPrdLink key={prd.id} prd={prd} />
                ))}
              </SidebarSection>
            ) : null}
          </div>
        </nav>

        <div className="mt-auto border-t border-sidebar-border px-3 pb-2 pt-3">
          <div className="flex items-center justify-between gap-2 text-xs text-sidebar-foreground/70">
            <span className="font-mono">v0.1.0</span>
            <span>serve</span>
          </div>
        </div>
      </aside>

      <main className="relative z-0 min-w-0 flex-1 overflow-auto p-2 md:pl-0.5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
          {children}
        </div>
      </main>
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <p className="px-3 text-xs font-medium text-sidebar-foreground/65">{title}</p>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  exact,
}: {
  to: "/";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}) {
  return (
    <Link to={to} activeOptions={{ exact }} className="block no-underline">
      {({ isActive }) => (
        <div
          className={cn(
            "flex h-8 items-center gap-2 rounded-lg border border-transparent px-3 text-sm font-medium transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span>{label}</span>
        </div>
      )}
    </Link>
  );
}

function SidebarPrdLink({ prd }: { prd: SidebarPrd }) {
  return (
    <Link
      to="/prds/$id"
      params={{ id: prd.id }}
      aria-label={`Open ${prd.title}`}
      className="block no-underline"
    >
      {({ isActive }) => (
        <div
          className={cn(
            "flex min-h-9 items-center gap-2 rounded-lg border border-transparent px-3 py-1.5 text-sm transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <PrdStatusIcon status={prd.status} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{prd.title}</span>
        </div>
      )}
    </Link>
  );
}
