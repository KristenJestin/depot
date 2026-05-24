import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { AdrListView, type AdrItem } from "#/web/components/adrs-page";
import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";
import { VALID_ADR_STATUSES, type AdrStatus } from "#/shared/validator";

type AdrListResponse = { items: AdrItem[] };

export const Route = createFileRoute("/projects/$id/adrs/")({
  component: AdrsListRoute,
});

function AdrsListRoute() {
  const { id } = Route.useParams();
  const [status, setStatus] = React.useState<AdrStatus | "all">("all");
  const [prdId, setPrdId] = React.useState("");

  const query = useQuery({
    queryKey: ["projects", id, "adrs", { status, prdId }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (prdId.trim() !== "") params.set("prdId", prdId.trim());
      const qs = params.toString();
      const res = await fetch(`/api/projects/${id}/adrs${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AdrListResponse;
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
              <BreadcrumbPage>ADRs</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>
      <PageContent className="mx-auto w-full max-w-4xl space-y-6 p-6">
        <header className="space-y-1">
          <h1 className="text-lg font-semibold">Architecture Decision Records</h1>
          <p className="text-xs text-muted-foreground">
            Read-only view. Create or amend ADRs with{" "}
            <code className="rounded bg-secondary px-1 py-0.5">depot adr</code>.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="block text-muted-foreground">Status</span>
            <Select
              value={status}
              onValueChange={(value) => setStatus((value as AdrStatus | "all") ?? "all")}
            >
              <SelectTrigger className="mt-1 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">all</SelectItem>
                {VALID_ADR_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">PRD id</span>
            <input
              type="text"
              value={prdId}
              onChange={(e) => setPrdId(e.target.value)}
              placeholder="(any)"
              className="mt-1 h-9 w-64 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            />
          </label>
        </div>

        {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {query.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {(query.error as Error).message}
          </p>
        )}
        {query.data && <AdrListView projectId={id} items={query.data.items} />}
      </PageContent>
    </PageShell>
  );
}
