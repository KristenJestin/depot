import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

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

type Artifact = {
  id: string;
  kind: string;
  path: string;
  number: number | null;
  title: string;
  status: string | null;
  supersededBy: string | null;
  linkedPrdRevisionId: string | null;
  lastModifiedAt: string;
  lastModifiedBySource: string;
};

type DocProfile = {
  id: string;
  name: string;
  targetRoot: string;
  language: string;
  style: string;
  sources: string;
  guardrails: string;
  commitPolicy: string;
};

type SyncRun = {
  id: string;
  ranAt: string;
  sinceRef: string | null;
  untilRef: string | null;
  triggeredByPrdId: string | null;
  filesChanged: string;
};

export const Route = createFileRoute("/projects/$id/docs")({
  component: DocsRoute,
});

function DocsRoute() {
  const { id } = Route.useParams();
  const docsQ = useQuery({
    queryKey: ["projects", id, "docs"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${id}/docs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as {
        artifacts: Artifact[];
        profiles: DocProfile[];
        lastRunsByProfile: Record<string, SyncRun[]>;
      };
    },
  });

  const data = docsQ.data;
  const adrs = data?.artifacts.filter((a) => a.kind === "adr") ?? [];
  const contexts = data?.artifacts.filter((a) => a.kind === "context") ?? [];
  const glossaries = data?.artifacts.filter((a) => a.kind === "glossary") ?? [];
  const freeforms = data?.artifacts.filter((a) => a.kind === "freeform") ?? [];

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
              <BreadcrumbPage>Docs</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>
      <PageContent className="mx-auto w-full max-w-4xl space-y-8 p-6">
        {docsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {docsQ.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {(docsQ.error as Error).message}
          </p>
        )}

        {data && (
          <>
            <ArtifactSection title="Architecture Decision Records (ADR)" items={adrs} />
            <ArtifactSection title="CONTEXT" items={contexts} />
            <ArtifactSection title="Glossary" items={glossaries} />
            <ArtifactSection title="Freeform docs" items={freeforms} />

            <section>
              <h2 className="mb-3 text-sm font-semibold">Doc profiles</h2>
              {data.profiles.length === 0 ? (
                <EmptyState message="No doc profiles configured. Run `depot doc profile create <name>` to create one." />
              ) : (
                <ul className="space-y-3">
                  {data.profiles.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-md border border-card-border bg-card p-4 text-sm"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="font-medium">{p.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {p.style}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Target: <code>{p.targetRoot}</code> · Language: {p.language} · Commit:{" "}
                        {p.commitPolicy}
                      </p>
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          Sources / guardrails
                        </summary>
                        <pre className="mt-2 overflow-auto rounded bg-secondary/40 p-2 text-[11px]">
                          {`sources: ${p.sources}\nguardrails: ${p.guardrails}`}
                        </pre>
                      </details>
                      <SyncHistory runs={data.lastRunsByProfile[p.id] ?? []} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </PageContent>
    </PageShell>
  );
}

function ArtifactSection({ title, items }: { title: string; items: Artifact[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="rounded-md border border-card-border bg-card p-3 text-sm">
            <div className="flex items-baseline gap-2">
              {a.number !== null && (
                <span className="font-mono text-xs text-muted-foreground">
                  #{String(a.number).padStart(4, "0")}
                </span>
              )}
              <span className="font-medium">{a.title}</span>
              {a.status && (
                <Badge variant="outline" className="text-[10px]">
                  {a.status}
                </Badge>
              )}
              {a.supersededBy && (
                <Badge variant="subtle" className="text-[10px]">
                  superseded
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <code>{a.path}</code> · last modified by {a.lastModifiedBySource}{" "}
              {new Date(a.lastModifiedAt).toLocaleString()}
            </p>
            {a.linkedPrdRevisionId && (
              <p className="mt-1 text-xs">
                <Link
                  to="/prds/$id"
                  params={{ id: a.linkedPrdRevisionId }}
                  className="text-primary underline"
                >
                  ↳ PRD that motivated this doc
                </Link>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SyncHistory({ runs }: { runs: SyncRun[] }) {
  if (runs.length === 0) return null;
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Sync history ({runs.length})
      </summary>
      <ul className="mt-2 space-y-1">
        {runs.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-[11px]">
            <span>{new Date(r.ranAt).toLocaleString()}</span>
            <span className="text-muted-foreground">since={r.sinceRef ?? "—"}</span>
            {r.triggeredByPrdId && (
              <Link
                to="/prds/$id"
                params={{ id: r.triggeredByPrdId }}
                className="text-primary underline"
              >
                PRD
              </Link>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
