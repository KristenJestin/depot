import { Link } from "@tanstack/react-router";
import * as React from "react";

import { Badge } from "#/web/components/ui/badge";
import { Button } from "#/web/components/ui/button";
import { EmptyState } from "#/web/components/ui/empty-state";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";
import { Markdown } from "#/web/components/markdown";
import { cn } from "#/web/lib/utils";
import type { DirectiveCategory } from "#/shared/validator";

// Row shape returned by `GET /api/projects/:id/directives` (list) — full enough
// to render the compact table and to seed the detail view before its own fetch
// resolves. Timestamps arrive as ISO strings over JSON.
export type DirectiveRow = {
  id: string;
  projectId: string;
  category: DirectiveCategory | null;
  scope: string;
  title: string;
  instruction: string;
  kind: "command" | "rule";
  repoTarget: string;
  blocking: boolean;
  position: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: "ok" | "fail" | null;
  lastRunOutput?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const ANY = "__any__";
export const PAGE_SIZE = 50;

export type SortKey = "category" | "scope" | "position";

export type FilterState = {
  category: string;
  scope: string;
  kind: string;
  repoTarget: string;
  enabled: string;
};

const EMPTY_FILTERS: FilterState = {
  category: ANY,
  scope: ANY,
  kind: ANY,
  repoTarget: ANY,
  enabled: ANY,
};

function uniqueSorted(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => v != null && v !== ""))].sort();
}

/**
 * Pure filter + sort over directive rows (PRD 0021 / T6). Extracted from the
 * table component so the filtering contract — "filtering by category /
 * repoTarget reduces the rows" — is unit-testable without driving the Base UI
 * Select portal.
 */
export function filterAndSortDirectives(
  items: DirectiveRow[],
  filters: FilterState,
  sort: SortKey,
): DirectiveRow[] {
  const rows = items.filter((d) => {
    if (filters.category !== ANY && d.category !== filters.category) return false;
    if (filters.scope !== ANY && d.scope !== filters.scope) return false;
    if (filters.kind !== ANY && d.kind !== filters.kind) return false;
    if (filters.repoTarget !== ANY && d.repoTarget !== filters.repoTarget) return false;
    if (filters.enabled === "enabled" && !d.enabled) return false;
    if (filters.enabled === "disabled" && d.enabled) return false;
    return true;
  });
  return [...rows].sort((a, b) => {
    if (sort === "category") {
      return (a.category ?? "").localeCompare(b.category ?? "") || a.position - b.position;
    }
    if (sort === "scope") {
      return a.scope.localeCompare(b.scope) || a.position - b.position;
    }
    return a.position - b.position || a.scope.localeCompare(b.scope);
  });
}

function RunStatusBadge({ status }: { status: "ok" | "fail" | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant={status === "ok" ? "statusDone" : "severityCritical"} className="text-[10px]">
      {status}
    </Badge>
  );
}

/**
 * Compact directives table with filters, sort, and pagination (PRD 0021 / T6).
 *
 * With ~60 directives (nyx) the previous per-scope card list was
 * unreadable. This renders one row per directive with the load-bearing
 * dimensions as columns — crucially `repoTarget`, which multi-repo projects
 * need to see and filter on — and links each row into the drill-in detail.
 */
export function DirectivesTable({
  projectId,
  items,
}: {
  projectId: string;
  items: DirectiveRow[];
}) {
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  const [sort, setSort] = React.useState<SortKey>("position");
  const [page, setPage] = React.useState(0);

  const categoryOptions = React.useMemo(() => uniqueSorted(items.map((d) => d.category)), [items]);
  const scopeOptions = React.useMemo(() => uniqueSorted(items.map((d) => d.scope)), [items]);
  const kindOptions = React.useMemo(() => uniqueSorted(items.map((d) => d.kind)), [items]);
  const repoTargetOptions = React.useMemo(
    () => uniqueSorted(items.map((d) => d.repoTarget)),
    [items],
  );

  const filtered = React.useMemo(
    () => filterAndSortDirectives(items, filters, sort),
    [items, filters, sort],
  );

  // Filtering/sorting can shrink the result below the current page offset;
  // clamp back into range so the user never lands on an empty page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  React.useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const updateFilter = (key: keyof FilterState, value: string | null) => {
    setFilters((prev) => ({ ...prev, [key]: value ?? ANY }));
    setPage(0);
  };

  if (items.length === 0) {
    return <EmptyState message="No directives yet. Add one below." />;
  }

  return (
    <div className="space-y-3" data-testid="directives-table">
      <div className="flex flex-wrap items-end gap-2">
        <FilterSelect
          label="Category"
          value={filters.category}
          options={categoryOptions}
          onChange={(v) => updateFilter("category", v)}
        />
        <FilterSelect
          label="Scope"
          value={filters.scope}
          options={scopeOptions}
          onChange={(v) => updateFilter("scope", v)}
        />
        <FilterSelect
          label="Kind"
          value={filters.kind}
          options={kindOptions}
          onChange={(v) => updateFilter("kind", v)}
        />
        <FilterSelect
          label="Repo target"
          value={filters.repoTarget}
          options={repoTargetOptions}
          onChange={(v) => updateFilter("repoTarget", v)}
        />
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Enabled</span>
          <Select value={filters.enabled} onValueChange={(v) => updateFilter("enabled", v ?? ANY)}>
            <SelectTrigger className="h-8 w-32" aria-label="Filter by enabled">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={ANY}>All</SelectItem>
              <SelectItem value="enabled">Enabled</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectPopup>
          </Select>
        </label>
        <label className="ml-auto text-xs">
          <span className="mb-1 block text-muted-foreground">Sort</span>
          <Select value={sort} onValueChange={(v) => setSort((v as SortKey) ?? "position")}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="position">Position</SelectItem>
              <SelectItem value="category">Category</SelectItem>
              <SelectItem value="scope">Scope</SelectItem>
            </SelectPopup>
          </Select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border border-card-border">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-card-border bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Repo target</th>
              <th className="px-3 py-2 font-medium">Enabled</th>
              <th className="px-3 py-2 font-medium">Last run</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No directives match the current filters.
                </td>
              </tr>
            ) : (
              pageRows.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-card-border last:border-b-0 hover:bg-accent/40"
                >
                  <td className="px-3 py-2">
                    <Badge variant="subtle" className="text-[10px]">
                      {d.category ?? "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{d.scope}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px]">
                      {d.kind}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to="/projects/$id/directives/$directiveId"
                      params={{ id: projectId, directiveId: d.id }}
                      className="font-medium text-current hover:text-primary"
                    >
                      {d.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <code className="text-[11px] text-muted-foreground">{d.repoTarget}</code>
                  </td>
                  <td className="px-3 py-2">
                    {d.enabled ? (
                      <Badge variant="subtle" className="text-[10px]">
                        on
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        off
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <RunStatusBadge status={d.lastRunStatus} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length} directive{filtered.length === 1 ? "" : "s"}
          {filtered.length !== items.length ? ` (of ${items.length})` : ""}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              Prev
            </Button>
            <span>
              Page {safePage + 1} / {pageCount}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="text-xs">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-36" aria-label={`Filter by ${label.toLowerCase()}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value={ANY}>All</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}

/**
 * Directive drill-in detail (PRD 0021 / T6). Shows every field the table
 * cannot: the full instruction (rendered as markdown for `rule` kinds, code for
 * commands), the last-run status + captured output, timestamps and position —
 * plus the Enable/Disable, Run, Edit and Remove actions wired by the caller.
 */
export function DirectiveDetailView({
  directive,
  onToggleEnabled,
  onRun,
  onEdit,
  onRemove,
  runResult,
  busy,
}: {
  directive: DirectiveRow;
  onToggleEnabled?: () => void;
  onRun?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
  runResult?: { ok: boolean; stdout: string; stderr: string } | null;
  busy?: boolean;
}) {
  return (
    <article className="space-y-6" data-testid="directive-detail">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-semibold">{directive.title}</h1>
          <Badge variant="subtle" className="text-[10px]">
            {directive.category ?? "—"}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {directive.kind}
          </Badge>
          {directive.blocking && (
            <Badge variant="outline" className="text-[10px]">
              blocking
            </Badge>
          )}
          {!directive.enabled && (
            <Badge variant="subtle" className="text-[10px]">
              disabled
            </Badge>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
          <Field label="Scope">{directive.scope}</Field>
          <Field label="Repo target">
            <code>{directive.repoTarget}</code>
          </Field>
          <Field label="Position">{directive.position}</Field>
          <Field label="Last run status">
            <RunStatusBadge status={directive.lastRunStatus} />
          </Field>
          <Field label="Last run at">
            {directive.lastRunAt ? new Date(directive.lastRunAt).toLocaleString() : "—"}
          </Field>
          <Field label="Created">
            {directive.createdAt ? new Date(directive.createdAt).toLocaleString() : "—"}
          </Field>
          <Field label="Updated">
            {directive.updatedAt ? new Date(directive.updatedAt).toLocaleString() : "—"}
          </Field>
        </dl>
      </header>

      {(onToggleEnabled || onRun || onEdit || onRemove) && (
        <div className="flex flex-wrap items-center gap-2">
          {onToggleEnabled && (
            <Button size="sm" variant="secondary" onClick={onToggleEnabled} disabled={busy}>
              {directive.enabled ? "Disable" : "Enable"}
            </Button>
          )}
          {onRun && directive.kind === "command" && (
            <Button size="sm" variant="secondary" onClick={onRun} disabled={busy}>
              Run
            </Button>
          )}
          {onEdit && (
            <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy}>
              Edit
            </Button>
          )}
          {onRemove && (
            <Button size="sm" variant="destructive" onClick={onRemove} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Instruction
        </h2>
        {directive.kind === "command" ? (
          <pre className="overflow-auto rounded-md border border-card-border bg-secondary/40 p-3 font-mono text-[12px]">
            {directive.instruction}
          </pre>
        ) : (
          <div className="rounded-md border border-card-border bg-card p-4">
            <Markdown source={directive.instruction} />
          </div>
        )}
      </section>

      {directive.lastRunOutput && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Last run output
          </h2>
          <pre className="overflow-auto rounded-md border border-card-border bg-secondary/40 p-3 font-mono text-[11px]">
            {directive.lastRunOutput}
          </pre>
        </section>
      )}

      {runResult && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Run result
          </h2>
          <p
            className={cn(
              "text-xs",
              runResult.ok ? "text-status-done-foreground" : "text-destructive",
            )}
          >
            {runResult.ok ? "ok" : "failed"}
          </p>
          {(runResult.stdout || runResult.stderr) && (
            <pre className="overflow-auto rounded-md border border-card-border bg-secondary/40 p-3 font-mono text-[11px]">
              {`${runResult.stdout}\n${runResult.stderr}`.trim()}
            </pre>
          )}
        </section>
      )}
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">{label}</span>
      <span className="text-xs text-foreground">{children}</span>
    </div>
  );
}
