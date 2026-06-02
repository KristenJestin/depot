import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CheckIcon,
  MilestoneIcon,
  PencilIcon,
  PlusIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";

import { Badge } from "#/web/components/ui/badge";
import { Button } from "#/web/components/ui/button";
import { Card } from "#/web/components/ui/card";
import { Input } from "#/web/components/ui/input";
import { StatusBadge } from "#/web/components/ui/status-badge";
import type { PrdDetailResponse } from "#/web/lib/api-types";

/**
 * Side-pane sections that expose PRD-level groupings (PRD 0019 / T4).
 *
 * Each widget is stateful only for its own draft input; data + mutations
 * flow through React Query so the parent detail page does not need to
 * forward callbacks. The three components share a small visual style
 * (`SidebarSection`) to stay consistent with the existing sidebar widgets
 * in `prd-sidebar.tsx` without coupling to its internal helpers.
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
  const [draft, setDraft] = React.useState("");
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
    onSuccess: () => {
      setDraft("");
      invalidate();
    },
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
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tags yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="PRD tags">
            {tags.map((tag) => (
              <li key={tag}>
                <Badge variant="subtle" className="gap-1 pr-1">
                  <TagIcon className="size-3" />
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => removeMutation.mutate(tag)}
                    disabled={pending}
                    className="inline-flex size-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <XIcon className="size-2.5" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const tag = draft.trim();
            if (tag.length === 0) return;
            addMutation.mutate(tag);
          }}
        >
          <label htmlFor="prd-tags-add" className="sr-only">
            New tag
          </label>
          <Input
            id="prd-tags-add"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="kebab-case"
            aria-label="Add tag"
            className="h-7 flex-1 text-xs"
          />
          <Button type="submit" size="sm" disabled={pending || draft.trim().length === 0}>
            <PlusIcon className="size-3" />
            Add
          </Button>
        </form>
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
  const [draft, setDraft] = React.useState(version ?? "");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setDraft(version ?? ""), [version]);

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

  return (
    <SidebarSection title="Milestone" testId="prd-milestone-section">
      <div className="space-y-3">
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = draft.trim();
              mutation.mutate(next.length === 0 ? null : next);
            }}
          >
            <label htmlFor="prd-milestone-input" className="sr-only">
              Milestone version
            </label>
            <Input
              id="prd-milestone-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="e.g. 2.6.1"
              aria-label="Milestone version"
              className="h-7 flex-1 text-xs"
              autoFocus
            />
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              <CheckIcon className="size-3" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(version ?? "");
                setEditing(false);
                setError(null);
              }}
              disabled={mutation.isPending}
            >
              <XIcon className="size-3" />
            </Button>
          </form>
        ) : version ? (
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/milestones/$version"
              params={{ version }}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              aria-label={`Open milestone ${version}`}
            >
              <MilestoneIcon className="size-3.5" />
              {version}
            </Link>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Edit milestone"
                onClick={() => setEditing(true)}
              >
                <PencilIcon className="size-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Clear milestone"
                onClick={() => mutation.mutate(null)}
                disabled={mutation.isPending}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">No milestone set.</p>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <PlusIcon className="size-3" />
              Set
            </Button>
          </div>
        )}
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
  const [draft, setDraft] = React.useState("");
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
    onSuccess: () => {
      setDraft("");
      invalidate();
    },
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

  return (
    <SidebarSection title="Dependencies" testId="prd-deps-section">
      <div className="space-y-4">
        <div className="space-y-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Depends on
          </h3>
          <DepList
            entries={dependencies}
            emptyLabel="No dependencies."
            onRemove={(prdId) => removeMutation.mutate(prdId)}
            pending={pending}
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Depended on by
          </h3>
          <DepList
            entries={dependents}
            emptyLabel="Nothing depends on this PRD."
            pending={pending}
          />
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = draft.trim();
            if (value.length === 0) return;
            addMutation.mutate(value);
          }}
        >
          <label htmlFor="prd-deps-add" className="sr-only">
            Depend on PRD id
          </label>
          <Input
            id="prd-deps-add"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="PRD id to depend on"
            aria-label="Depend on PRD id"
            className="h-7 flex-1 text-xs font-mono"
          />
          <Button type="submit" size="sm" disabled={pending || draft.trim().length === 0}>
            <PlusIcon className="size-3" />
            Add
          </Button>
        </form>
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SidebarSection>
  );
}

function DepList({
  entries,
  emptyLabel,
  onRemove,
  pending,
}: {
  entries: DepEntry[];
  emptyLabel: string;
  onRemove?: (prdId: string) => void;
  pending?: boolean;
}) {
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {entries.map((entry) => (
        <li
          key={entry.prdId}
          className="flex items-center justify-between gap-2 rounded-md border border-card-border bg-card px-2 py-1.5 text-xs"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
            {entry.headRevisionId ? (
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
            )}
            {entry.status ? <StatusBadge status={entry.status} /> : null}
          </div>
          {onRemove ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove dependency on ${entry.prdId}`}
              onClick={() => onRemove(entry.prdId)}
              disabled={pending}
            >
              <XIcon className="size-3" />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
