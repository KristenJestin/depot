import { use, Suspense } from "react";

import { api } from "#/web/lib/api";
import { Card } from "#/web/components/ui/card";
import { StatusBadge } from "#/web/components/ui/status-badge";
import { EmptyState } from "#/web/components/ui/empty-state";
import { DotLoader } from "#/web/components/ui/dot-loader";

type PrdListResponse = Awaited<ReturnType<typeof api.prds.list>>;

const prdListPromise = api.prds.list();

function PrdList({ promise }: { promise: Promise<PrdListResponse> }) {
  const { prds } = use(promise);

  if (!prds.length) {
    return <EmptyState message="No PRDs yet." />;
  }

  return (
    <ul className="space-y-3">
      {prds.map((prd) => (
        <li key={prd.id}>
          <Card size="sm">
            <Card.Header>
              <Card.Title>{prd.title}</Card.Title>
              <StatusBadge status={prd.status} />
            </Card.Header>
            {prd.context && (
              <Card.Content>
                <p className="text-sm text-muted-foreground">{prd.context}</p>
              </Card.Content>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function PrdsPage() {
  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="font-display text-2xl font-semibold mb-6">PRDs</h1>
      <Suspense fallback={<DotLoader preset="thinking" />}>
        <PrdList promise={prdListPromise} />
      </Suspense>
    </main>
  );
}
