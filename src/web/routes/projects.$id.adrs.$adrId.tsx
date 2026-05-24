import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AdrDetailView, type AdrItem } from "#/web/components/adrs-page";
import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";

type AdrDetailResponse = {
  adr: AdrItem;
  supersededBy: AdrItem | null;
  supersedes: AdrItem | null;
};

export const Route = createFileRoute("/projects/$id/adrs/$adrId")({
  component: AdrDetailRoute,
});

function AdrDetailRoute() {
  const { id, adrId } = Route.useParams();

  const query = useQuery({
    queryKey: ["adrs", adrId],
    queryFn: async () => {
      const res = await fetch(`/api/adrs/${adrId}`);
      if (res.status === 404) throw new Error("ADR not found");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AdrDetailResponse;
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
              <Link
                to="/projects/$id/adrs"
                params={{ id }}
                className="transition-colors hover:text-foreground"
              >
                ADRs
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {query.data ? `ADR-${String(query.data.adr.number).padStart(4, "0")}` : "…"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>
      <PageContent className="mx-auto w-full max-w-4xl space-y-6 p-6">
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {query.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {(query.error as Error).message}
          </p>
        )}
        {query.data && (
          <AdrDetailView
            adr={query.data.adr}
            supersededBy={query.data.supersededBy}
            supersedes={query.data.supersedes}
          />
        )}
      </PageContent>
    </PageShell>
  );
}
