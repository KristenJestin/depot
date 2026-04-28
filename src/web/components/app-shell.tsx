import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, FolderOpen, CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { contextQuery, workspacesQuery, switchWorkspace } from "../lib/queries";
import type { Workspace } from "../lib/api-types";

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

  const label = current ? workspaceDisplayName(current) : "No workspace";
  const projectName = current?.projectName ?? null;

  return (
    <div ref={ref} className="relative px-2 pb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors",
          "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent",
        )}
      >
        <FolderOpen className="size-3.5 shrink-0 text-sidebar-foreground/60" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate text-sidebar-accent-foreground">{label}</div>
          {projectName && (
            <div className="text-2xs text-sidebar-foreground/50 truncate">{projectName}</div>
          )}
        </div>
        <ChevronsUpDownIcon className="size-3 shrink-0 text-sidebar-foreground/40" />
      </button>

      {open && (
        <div className="absolute left-2 right-2 bottom-full mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="py-1 max-h-60 overflow-y-auto">
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
                    "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors text-sm",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "text-popover-foreground hover:bg-accent/60",
                  )}
                >
                  <CheckIcon
                    className={cn("size-3 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{workspaceDisplayName(ws)}</div>
                    <div className="text-2xs text-muted-foreground truncate">{ws.projectName}</div>
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
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col shrink-0 w-(--sidebar-width) bg-sidebar border-r border-sidebar-border">
        {/* Logo */}
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <div className="shrink-0 size-5.5 rounded-md depot-logo-gradient" />
            <div>
              <div className="text-sm font-semibold text-sidebar-accent-foreground leading-tight">
                depot
              </div>
              <div className="text-2xs text-sidebar-foreground/60 leading-tight">serve</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-1">
          <Link to="/" activeOptions={{ exact: true }} className="mb-0.5 block no-underline">
            {({ isActive }) => (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md transition-colors px-2.5 py-1 text-sm",
                  isActive
                    ? "text-sidebar-accent-foreground bg-sidebar-accent"
                    : "text-sidebar-foreground hover:text-sidebar-accent-foreground bg-transparent",
                )}
              >
                <LayoutDashboard className="size-3.5" />
                Overview
              </div>
            )}
          </Link>
        </nav>

        {/* Separator */}
        <div className="h-px bg-sidebar-border my-1" />

        {/* Workspace switcher */}
        <WorkspaceSwitcher />

        {/* Version */}
        <div className="px-3 pt-1.5 pb-2.5 border-t border-sidebar-border">
          <span className="font-mono text-2xs text-sidebar-foreground/60">v0.1.0 · serve</span>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
    </div>
  );
}
