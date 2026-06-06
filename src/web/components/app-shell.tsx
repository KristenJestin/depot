import * as React from "react";

import { AppSidebar } from "#/web/components/app-sidebar";

/**
 * Global `app-shell` layout: a persistent left sidebar plus a main content
 * area, no top nav. Every route renders inside the card-framed main area.
 *
 * PRD 0026 / S1 — the main area is `overflow-hidden` so the card frame never
 * gets pushed under the viewport bottom by a tall route. Each route declares
 * its own scrollable region (typically the `PageContent` inside `PageShell`,
 * or the three internal scrolls of `ThreePane`).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-dvh overflow-hidden bg-sidebar text-foreground">
      <AppSidebar />

      <main className="relative z-0 min-w-0 flex-1 overflow-hidden p-2 md:pl-0.5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
          {children}
        </div>
      </main>
    </div>
  );
}
