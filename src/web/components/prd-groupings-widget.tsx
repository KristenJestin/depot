import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon, MilestoneIcon, PencilIcon, TagIcon } from "lucide-react";
import * as React from "react";

import { Button } from "#/web/components/ui/button";
import { Card } from "#/web/components/ui/card";
import { SidebarAddForm } from "#/web/components/ui/sidebar-add-form";
import { SidebarItemList } from "#/web/components/ui/sidebar-item-list";
import { StatusBadge } from "#/web/components/ui/status-badge";
import type { PrdDetailResponse } from "#/web/lib/api-types";

/**
 * Side-pane sections that expose PRD-level groupings (PRD 0019 / T4,
 * uniformised in PRD 0026 / S3).
 *
 * The three widgets (Tags, Milestone, Dependencies) are now thin wrappers
 * around two shared deep modules — `SidebarItemList` and `SidebarAddForm` —
 * so they share the exact same icon position, hover colour, remove button
 * size and add-form shape. Each widget's own logic stays focused on:
 *
 *   1. fetching data through React Query,
 *   2. firing the right mutation on add / remove,
 *   3. mapping the data to the render props (icon, label, key).
 */

type DepEntry = PrdDetailResponse["dependencies"][number];

function SidebarSection({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      <Card className="border border-card-border p-4">{children}</Card>
    </section>
  );
}

export function PrdTagsWidget({ prdRevisionId, tags }: { prdRevisionId: string; tags: string[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["prds"] });
    void queryClient.invalidateQueries({ queryKey: ["prds", prdRevisionId] });
  };

  const addMutation = useMutation({
    mutationFn: async (tag: string) => {
      setError(null);
      const res = await fetch(`/api/prds/${prdRevisionId}/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: invalidate,
    onError: (e) => setError((e as Error).message),
  });

  const removeMutation = useMutation({
    mutationFn: async (tag: string) => {
      setError(null);
      const res = await fetch(`/api/prds/${prdRevisionId}/tags/${encodeURIComponent(tag)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: invalidate,
    onError: (e) => setError((e as Error).message),
  });

  const pending = addMutation.isPending || removeMutation.isPending;

  return (
    <SidebarSection title="Tags" testId="prd-tags-section">
      <div className="space-y-3">
        <SidebarItemList<string>
          items={tags}
          emptyLabel="No tags yet."
          layout="pills"
          renderIcon={() => <TagIcon className="size-3" />}
          renderLabel={(tag) => <span>{tag}</span>}
          getKey={(tag) => tag}
          onRemove={(tag) => removeMutation.mutate(tag)}
          pending={pending}
        />
        <SidebarAddForm
          placeholder="kebab-case"
          ariaLabel="Add tag"
          onAdd={(value) => addMutation.mutate(value)}
          pending={pending}
        />
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SidebarSection>
  );
}

export function PrdMilestoneWidget({
  prdRevisionId,
  version,
}: {
  prdRevisionId: string;
  version: string | null;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["prds"] });
    void queryClient.invalidateQueries({ queryKey: ["prds", prdRevisionId] });
    void queryClient.invalidateQueries({ queryKey: ["milestones"] });
  };

  const mutation = useMutation({
    mutationFn: async (next: string | null) => {
      setError(null);
      const res = await fetch(`/api/prds/${prdRevisionId}/milestone`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (e) => setError((e as Error).message),
  });

  const items = version ? [version] : [];

  return (
    <SidebarSection title="Milestone" testId="prd-milestone-section">
      <div className="space-y-3">
        {editing ? (
          <SidebarAddForm
            placeholder="e.g. 2.6.1"
            ariaLabel="Milestone version"
            buttonLabel="Save"
            onAdd={(value) => mutation.mutate(value)}
            pending={mutation.isPending}
          />
        ) : (
          <SidebarItemList<string>
            items={items}
            emptyLabel="No milestone set."
            layout="pills"
            renderIcon={() => <MilestoneIcon className="size-3.5" />}
            renderLabel={(v) => (
              <Link
                to="/milestones/$version"
                params={{ version: v }}
                className="font-medium text-primary hover:underline"
                aria-label={`Open milestone ${v}`}
              >
                {v}
              </Link>
            )}
            getKey={(v) => v}
            onRemove={() => mutation.mutate(null)}
            pending={mutation.isPending}
          />
        )}
        <div className="flex items-center justify-end gap-1.5">
          {editing ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={version ? "Edit milestone" : "Set milestone"}
              onClick={() => setEditing(true)}
            >
              <PencilIcon className="size-3" />
              {version ? "Edit" : "Set"}
            </Button>
          )}
        </div>
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SidebarSection>
  );
}

export function PrdDependenciesWidget({
  prdRevisionId,
  dependencies,
  dependents,
}: {
  prdRevisionId: string;
  dependencies: DepEntry[];
  dependents: DepEntry[];
}) {
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["prds"] });
    void queryClient.invalidateQueries({ queryKey: ["prds", prdRevisionId] });
  };

  const addMutation = useMutation({
    mutationFn: async (dependsOnPrdId: string) => {
      setError(null);
      const res = await fetch(`/api/prds/${prdRevisionId}/dependencies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dependsOnPrdId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: invalidate,
    onError: (e) => setError((e as Error).message),
  });

  const removeMutation = useMutation({
    mutationFn: async (depPrdId: string) => {
      setError(null);
      const res = await fetch(
        `/api/prds/${prdRevisionId}/dependencies/${encodeURIComponent(depPrdId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: invalidate,
    onError: (e) => setError((e as Error).message),
  });

  const pending = addMutation.isPending || removeMutation.isPending;

  const renderDepLabel = (entry: DepEntry) =>
    entry.headRevisionId ? (
      <Link
        to="/prds/$id"
        params={{ id: entry.headRevisionId }}
        className="truncate font-medium text-foreground hover:underline"
        title={entry.prdId}
      >
        {entry.title ?? entry.prdId}
      </Link>
    ) : (
      <span className="truncate font-mono text-muted-foreground" title={entry.prdId}>
        {entry.prdId}
      </span>
    );

  return (
    <SidebarSection title="Dependencies" testId="prd-deps-section">
      <div className="space-y-4">
        <div className="space-y-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Depends on
          </h3>
          <SidebarItemList<DepEntry>
            items={dependencies}
            emptyLabel="No dependencies."
            layout="rows"
            renderIcon={() => <ArrowRightIcon className="size-3" />}
            renderLabel={(entry) => (
              <span className="inline-flex min-w-0 items-center gap-2">
                {renderDepLabel(entry)}
                {entry.status ? <StatusBadge status={entry.status} /> : null}
              </span>
            )}
            getKey={(entry) => entry.prdId}
            onRemove={(entry) => removeMutation.mutate(entry.prdId)}
            pending={pending}
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Depended on by
          </h3>
          <SidebarItemList<DepEntry>
            items={dependents}
            emptyLabel="Nothing depends on this PRD."
            layout="rows"
            renderIcon={() => <ArrowRightIcon className="size-3" />}
            renderLabel={(entry) => (
              <span className="inline-flex min-w-0 items-center gap-2">
                {renderDepLabel(entry)}
                {entry.status ? <StatusBadge status={entry.status} /> : null}
              </span>
            )}
            getKey={(entry) => entry.prdId}
            pending={pending}
          />
        </div>

        <SidebarAddForm
          placeholder="PRD id to depend on"
          ariaLabel="Depend on PRD id"
          inputClassName="font-mono"
          onAdd={(value) => addMutation.mutate(value)}
          pending={pending}
        />
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SidebarSection>
  );
}
