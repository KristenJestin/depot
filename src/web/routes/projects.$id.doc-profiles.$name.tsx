import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { DocProfileDetailView, type DocProfileDetail } from "#/web/components/doc-profiles-page";
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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";

export const Route = createFileRoute("/projects/$id/doc-profiles/$name")({
  component: DocProfileDetailRoute,
});

function DocProfileDetailRoute() {
  const { id, name } = Route.useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ["projects", id, "doc-profiles", name],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${id}/doc-profiles/${encodeURIComponent(name)}`);
      if (res.status === 404) throw new Error("Doc profile not found");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { profile: DocProfileDetail };
    },
  });

  const patchM = useMutation({
    mutationFn: async (body: Partial<DocProfileDetail>) => {
      setError(null);
      const res = await fetch(`/api/projects/${id}/doc-profiles/${encodeURIComponent(name)}`, {
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
      void queryClient.invalidateQueries({ queryKey: ["projects", id, "doc-profiles", name] });
      void queryClient.invalidateQueries({ queryKey: ["projects", id, "docs"] });
    },
  });

  const profile = query.data?.profile;

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
                Doc profiles
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{profile?.name ?? name}</BreadcrumbPage>
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
        {profile &&
          (editing ? (
            <DocProfileEditForm
              profile={profile}
              busy={patchM.isPending}
              onCancel={() => setEditing(false)}
              onSave={(body) => patchM.mutate(body)}
            />
          ) : (
            <DocProfileDetailView profile={profile} onEdit={() => setEditing(true)} />
          ))}
      </PageContent>
    </PageShell>
  );
}

function DocProfileEditForm({
  profile,
  busy,
  onCancel,
  onSave,
}: {
  profile: DocProfileDetail;
  busy?: boolean;
  onCancel: () => void;
  onSave: (body: {
    targetRoot: string;
    targetPattern: string;
    language: string;
    style: "narrative" | "reference" | "mixed";
    audience: string | null;
    guardrails: string[];
    commitPolicy: "leave-in-working-tree" | "commit-with-message";
  }) => void;
}) {
  const [targetRoot, setTargetRoot] = React.useState(profile.targetRoot);
  const [targetPattern, setTargetPattern] = React.useState(profile.targetPattern);
  const [language, setLanguage] = React.useState(profile.language);
  const [style, setStyle] = React.useState(profile.style);
  const [audience, setAudience] = React.useState(profile.audience ?? "");
  const [guardrails, setGuardrails] = React.useState(profile.guardrails.join("\n"));
  const [commitPolicy, setCommitPolicy] = React.useState(profile.commitPolicy);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          targetRoot: targetRoot.trim(),
          targetPattern: targetPattern.trim(),
          language: language.trim(),
          style: style as "narrative" | "reference" | "mixed",
          audience: audience.trim() ? audience.trim() : null,
          guardrails: guardrails
            .split("\n")
            .map((g) => g.trim())
            .filter((g) => g.length > 0),
          commitPolicy: commitPolicy as "leave-in-working-tree" | "commit-with-message",
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Labelled label="Target root">
          <Input type="text" value={targetRoot} onChange={(e) => setTargetRoot(e.target.value)} />
        </Labelled>
        <Labelled label="Target pattern">
          <Input
            type="text"
            value={targetPattern}
            onChange={(e) => setTargetPattern(e.target.value)}
          />
        </Labelled>
        <Labelled label="Language">
          <Input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} />
        </Labelled>
        <Labelled label="Style">
          <Select value={style} onValueChange={(v) => setStyle(v ?? "mixed")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="narrative">narrative</SelectItem>
              <SelectItem value="reference">reference</SelectItem>
              <SelectItem value="mixed">mixed</SelectItem>
            </SelectPopup>
          </Select>
        </Labelled>
        <Labelled label="Audience">
          <Input type="text" value={audience} onChange={(e) => setAudience(e.target.value)} />
        </Labelled>
        <Labelled label="Commit policy">
          <Select
            value={commitPolicy}
            onValueChange={(v) => setCommitPolicy(v ?? "leave-in-working-tree")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="leave-in-working-tree">leave-in-working-tree</SelectItem>
              <SelectItem value="commit-with-message">commit-with-message</SelectItem>
            </SelectPopup>
          </Select>
        </Labelled>
      </div>
      <Labelled label="Guardrails (one per line)">
        <textarea
          value={guardrails}
          onChange={(e) => setGuardrails(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </Labelled>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={busy || !targetRoot.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
