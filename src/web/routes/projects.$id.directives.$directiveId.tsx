import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { DirectiveDetailView, type DirectiveRow } from "#/web/components/directives-page";
import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Button } from "#/web/components/ui/button";
import { Input } from "#/web/components/ui/input";
import { Textarea } from "#/web/components/ui/textarea";

export const Route = createFileRoute("/projects/$id/directives/$directiveId")({
  component: DirectiveDetailRoute,
});

function DirectiveDetailRoute() {
  const { id, directiveId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [runResult, setRunResult] = React.useState<{
    ok: boolean;
    stdout: string;
    stderr: string;
  } | null>(null);

  const query = useQuery({
    queryKey: ["projects", id, "directives", directiveId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${id}/directives/${directiveId}`);
      if (res.status === 404) throw new Error("Directive not found");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { directive: DirectiveRow };
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["projects", id, "directives", directiveId],
    });
    void queryClient.invalidateQueries({ queryKey: ["projects", id, "directives"] });
  };

  const patchM = useMutation({
    mutationFn: async (body: Partial<DirectiveRow>) => {
      setError(null);
      const res = await fetch(`/api/projects/${id}/directives/${directiveId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
  });

  const runM = useMutation({
    mutationFn: async () => {
      setError(null);
      setRunResult(null);
      const res = await fetch(`/api/projects/${id}/directives/${directiveId}/run`, {
        method: "POST",
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { ok: boolean; stdout: string; stderr: string };
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: (data) => {
      setRunResult({ ok: data.ok, stdout: data.stdout, stderr: data.stderr });
      invalidate();
    },
  });

  const removeM = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${id}/directives/${directiveId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", id, "directives"] });
      void navigate({ to: "/projects/$id/settings", params: { id } });
    },
  });

  const directive = query.data?.directive;
  const busy = patchM.isPending || runM.isPending || removeM.isPending;

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
                to="/projects/$id/settings"
                params={{ id }}
                className="transition-colors hover:text-foreground"
              >
                Directives
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{directive?.title ?? "…"}</BreadcrumbPage>
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
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </p>
        )}
        {directive &&
          (editing ? (
            <DirectiveEditForm
              directive={directive}
              busy={busy}
              onCancel={() => setEditing(false)}
              onSave={(body) => patchM.mutate(body)}
            />
          ) : (
            <DirectiveDetailView
              directive={directive}
              busy={busy}
              runResult={runResult}
              onToggleEnabled={() => patchM.mutate({ enabled: !directive.enabled })}
              onRun={() => runM.mutate()}
              onEdit={() => setEditing(true)}
              onRemove={() => removeM.mutate()}
            />
          ))}
      </PageContent>
    </PageShell>
  );
}

function DirectiveEditForm({
  directive,
  busy,
  onCancel,
  onSave,
}: {
  directive: DirectiveRow;
  busy?: boolean;
  onCancel: () => void;
  onSave: (body: { title: string; instruction: string; repoTarget: string }) => void;
}) {
  const [title, setTitle] = React.useState(directive.title);
  const [instruction, setInstruction] = React.useState(directive.instruction);
  const [repoTarget, setRepoTarget] = React.useState(directive.repoTarget);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          title: title.trim(),
          instruction: instruction.trim(),
          repoTarget: repoTarget.trim(),
        });
      }}
    >
      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Title</span>
        <Input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {directive.kind === "command" && (
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Repo target</span>
          <Input
            type="text"
            value={repoTarget}
            onChange={(e) => setRepoTarget(e.target.value)}
            placeholder="auto | all | workspace | <repo-name>"
          />
        </label>
      )}
      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Instruction</span>
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={8}
          className="font-mono"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={busy || !title.trim() || !instruction.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
