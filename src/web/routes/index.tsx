import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  FileTextIcon,
  Loader2Icon,
  PenLineIcon,
  SearchIcon,
} from "lucide-react";

import { prdsQuery } from "../lib/queries";
import { relativeDate } from "../lib/format";
import { DotLoader } from "../components/ui/dot-loader";
import { EmptyState } from "../components/ui/empty-state";
import { Input } from "../components/ui/input";
import { StatusBadge } from "../components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { MetricCard } from "../components/metric-card";
import { PageHeader } from "../components/page-header";

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
  const navigate = useNavigate();
  const [search, setSearch] = React.useState("");

  const prds = data.prds;
  const total = prds.length;
  const doneCount = prds.filter((p) => p.status === "done").length;
  const inProgressCount = prds.filter((p) => p.status === "in_progress").length;
  const draftCount = prds.filter((p) => p.status === "draft").length;

  const filtered = search
    ? prds.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
    : prds;

  if (total === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          message="No PRDs yet."
          action={<span className="font-mono text-xs text-muted-foreground">depot prd init</span>}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-10 space-y-8 max-w-7xl mx-auto">
        <PageHeader title="Project Overview" />

        {/* Metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard icon={<FileTextIcon />} label="Total PRDs" value={total}>
            <span className="text-xs text-muted-foreground">{inProgressCount} in progress</span>
          </MetricCard>

          <MetricCard icon={<Loader2Icon />} label="In Progress" value={inProgressCount}>
            <span className="text-xs text-muted-foreground">
              {inProgressCount === 0 ? "No active PRDs" : "Active PRDs"}
            </span>
          </MetricCard>

          <MetricCard icon={<CheckCircle2Icon />} label="Completed" value={doneCount}>
            <span className="text-xs text-success font-medium">{doneCount} completed</span>
          </MetricCard>

          <MetricCard icon={<PenLineIcon />} label="Drafts" value={draftCount}>
            <span className="text-xs text-muted-foreground">In preparation</span>
          </MetricCard>
        </div>

        {/* PRD table */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">PRDs</h2>
            <div className="relative w-64">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search PRDs…"
                className="pl-9"
              />
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            {filtered.length === 0 ? (
              <EmptyState message="No PRDs match your search." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent cursor-default">
                    <TableHead>PRD</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((prd) => (
                    <TableRow
                      key={prd.id}
                      className="cursor-pointer"
                      onClick={() => navigate({ to: "/prds/$id", params: { id: prd.id } })}
                    >
                      <TableCell>
                        <div className="font-mono text-2xs text-muted-foreground mb-0.5">
                          {prd.id}
                        </div>
                        <div className="font-medium group-hover:text-primary transition-colors">
                          {prd.title}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={prd.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {relativeDate(prd.updatedAt)}
                      </TableCell>
                      <TableCell className="w-10 text-right">
                        <ChevronRightIcon className="size-4 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all -translate-x-2 group-hover:translate-x-0" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
