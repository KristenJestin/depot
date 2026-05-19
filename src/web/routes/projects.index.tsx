import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CogIcon, FileTextIcon, FolderIcon, ListChecksIcon } from "lucide-react";

import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Badge } from "#/web/components/ui/badge";
import { EmptyState } from "#/web/components/ui/empty-state";

type ProjectItem = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  prdCount: number;
  workspaceCount: number;
  docCount: number;
  directiveCount: number;
};

export const Route = createFileRoute("/projects/")({
  component: ProjectsIndexRoute,
});

function ProjectsIndexRoute() {
  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: ProjectItem[] };
    },
  });

  return (
    <PageShell>
      <PageTopBar>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link to="/" className="transition-colors hover:text-foreground">
                Dashboard
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Projects</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>
      <PageContent className="mx-auto w-full max-w-5xl space-y-6 p-6">
        <header>
          <h1 className="text-lg font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Per-project settings, docs, directives, PRDs. Pick a project to drill in.
          </p>
        </header>
        {projectsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {projectsQ.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {(projectsQ.error as Error).message}
          </p>
        )}
        {projectsQ.data &&
          (projectsQ.data.items.length === 0 ? (
            <EmptyState message="No projects yet. Run `depot init` in a workspace to create one." />
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {projectsQ.data.items.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col gap-3 rounded-lg border border-card-border bg-card p-4"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold">{p.name}</h2>
                      {p.description && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {p.description}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                      {p.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <Counter
                      icon={<FolderIcon className="size-3.5" />}
                      label="WS"
                      n={p.workspaceCount}
                    />
                    <Counter
                      icon={<ListChecksIcon className="size-3.5" />}
                      label="PRDs"
                      n={p.prdCount}
                    />
                    <Counter
                      icon={<FileTextIcon className="size-3.5" />}
                      label="Docs"
                      n={p.docCount}
                    />
                    <Counter
                      icon={<CogIcon className="size-3.5" />}
                      label="Dirs"
                      n={p.directiveCount}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Link
                      to="/projects/$id/settings"
                      params={{ id: p.id }}
                      className="rounded-md border border-card-border bg-secondary px-2 py-1 transition-colors hover:bg-accent"
                    >
                      Settings
                    </Link>
                    <Link
                      to="/projects/$id/docs"
                      params={{ id: p.id }}
                      className="rounded-md border border-card-border bg-secondary px-2 py-1 transition-colors hover:bg-accent"
                    >
                      Docs
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </PageContent>
    </PageShell>
  );
}

function Counter({ icon, label, n }: { icon: React.ReactNode; label: string; n: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-card-border/60 bg-background px-2 py-1">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium tabular-nums">{n}</span>
    </div>
  );
}
