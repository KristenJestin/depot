import { Link } from "@tanstack/react-router";

import { Badge } from "#/web/components/ui/badge";
import { EmptyState } from "#/web/components/ui/empty-state";
import { Markdown } from "#/web/components/markdown";

// Plain row shape used by the ADR list/detail views — mirrors the JSON shape
// returned by `GET /api/projects/:projectId/adrs` and `GET /api/adrs/:id`,
// with timestamps already serialised to ISO strings.
export type AdrItem = {
  id: string;
  projectId: string;
  prdId: string | null;
  number: number;
  title: string;
  status: "proposed" | "accepted" | "superseded";
  body: string;
  supersededByAdrId: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatAdrNumber(n: number): string {
  return `ADR-${String(n).padStart(4, "0")}`;
}

export function AdrListView({ projectId, items }: { projectId: string; items: AdrItem[] }) {
  if (items.length === 0) {
    return <EmptyState message="No ADRs yet. Create one from the CLI with `depot adr create`." />;
  }
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="rounded-md border border-card-border bg-card p-3 text-sm">
          <Link
            to="/projects/$id/adrs/$adrId"
            params={{ id: projectId, adrId: a.id }}
            className="flex items-baseline gap-2 no-underline text-current hover:text-primary"
          >
            <span className="font-mono text-xs text-muted-foreground">
              {formatAdrNumber(a.number)}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
            <Badge variant="outline" className="text-[10px]">
              {a.status}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AdrDetailView({
  adr,
  supersededBy,
  supersedes,
}: {
  adr: AdrItem;
  supersededBy: AdrItem | null;
  supersedes: AdrItem | null;
}) {
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm text-muted-foreground">
            {formatAdrNumber(adr.number)}
          </span>
          <h1 className="min-w-0 flex-1 text-xl font-semibold">{adr.title}</h1>
          <Badge variant="outline" className="text-[10px]">
            {adr.status}
          </Badge>
        </div>
        <dl className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <Relation label="PRD source">
            {adr.prdId ? (
              <Link
                to="/prds/$id"
                params={{ id: adr.prdId }}
                aria-label={`PRD source: ${adr.prdId}`}
                className="text-primary hover:underline"
              >
                {adr.prdId}
              </Link>
            ) : (
              <span>—</span>
            )}
          </Relation>
          <Relation label="Superseded by">
            {supersededBy ? (
              <Link
                to="/projects/$id/adrs/$adrId"
                params={{ id: supersededBy.projectId, adrId: supersededBy.id }}
                aria-label={`Superseded by ${formatAdrNumber(supersededBy.number)}`}
                className="text-primary hover:underline"
              >
                <span className="font-mono">{formatAdrNumber(supersededBy.number)}</span>
                <span aria-hidden="true"> · </span>
                <span>{supersededBy.title}</span>
              </Link>
            ) : (
              <span>—</span>
            )}
          </Relation>
          <Relation label="Supersedes">
            {supersedes ? (
              <Link
                to="/projects/$id/adrs/$adrId"
                params={{ id: supersedes.projectId, adrId: supersedes.id }}
                aria-label={`Supersedes ${formatAdrNumber(supersedes.number)}`}
                className="text-primary hover:underline"
              >
                <span className="font-mono">{formatAdrNumber(supersedes.number)}</span>
                <span aria-hidden="true"> · </span>
                <span>{supersedes.title}</span>
              </Link>
            ) : (
              <span>—</span>
            )}
          </Relation>
        </dl>
      </header>

      <section className="rounded-md border border-card-border bg-card p-4">
        <Markdown source={adr.body} />
      </section>
    </article>
  );
}

function Relation({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">{label}</span>
      <span className="text-xs">{children}</span>
    </div>
  );
}
