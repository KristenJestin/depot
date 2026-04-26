import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { prdsQuery } from "../lib/queries";
import { Card } from "../components/ui/card";
import { StatusBadge } from "../components/ui/status-badge";
import { EmptyState } from "../components/ui/empty-state";
import { DotLoader } from "../components/ui/dot-loader";

export const Route = createFileRoute("/")({
  loader: prdsQuery.list.ensureQueryData,
  pendingComponent: () => (
    <div className="flex items-center justify-center h-full">
      <DotLoader preset="thinking" label="Loading…" />
    </div>
  ),
  component: RouteComponent,
});

function RouteComponent() {
  const { data } = prdsQuery.list.useSuspense();

  return (
    <main className="max-w-2xl mx-auto p-8 w-full">
      <h1 className="font-display text-2xl font-semibold mb-6">PRDs</h1>
      {data.prds.length === 0 ? (
        <EmptyState message="No PRDs yet." />
      ) : (
        <ul className="space-y-3">
          {data.prds.map((prd) => (
            <li key={prd.id}>
              <Link to="/prds/$id" params={{ id: prd.id }} className="block no-underline">
                <Card size="sm" className="hover:border-border/70 transition-colors cursor-pointer">
                  <Card.Header>
                    <Card.Title>{prd.title}</Card.Title>
                    <StatusBadge status={prd.status} />
                  </Card.Header>
                  {prd.context && (
                    <Card.Content>
                      <p className="text-sm text-muted-foreground line-clamp-2">{prd.context}</p>
                    </Card.Content>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
