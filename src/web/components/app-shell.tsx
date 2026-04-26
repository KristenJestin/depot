import * as React from "react";
import { Link } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";

import { cn } from "../lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col shrink-0 overflow-hidden w-(--sidebar-width) bg-sidebar border-r border-sidebar-border">
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
