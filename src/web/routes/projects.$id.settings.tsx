import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import { SettingsTree, type SettingsSection } from "#/web/components/settings-tree";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Button } from "#/web/components/ui/button";
import { Badge } from "#/web/components/ui/badge";
import { Checkbox } from "#/web/components/ui/checkbox";
import { EmptyState } from "#/web/components/ui/empty-state";
import { Input } from "#/web/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";
import { Textarea } from "#/web/components/ui/textarea";
import { cn } from "#/web/lib/utils";

type ConfigItem = {
  key: string;
  label: string;
  description: string;
  defaultValue: string | null;
  currentValue: string | null;
  source: string | null;
  updatedAt: string | null;
};

type Directive = {
  id: string;
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
};

type Repo = {
  id: string | null;
  name: string;
  path: string;
  isPrimary: boolean;
  baseBranch: string;
  implicit?: boolean;
};

type DocProfile = {
  id: string;
  name: string;
  targetRoot: string;
  language: string;
  style: string;
  sources: string;
  guardrails: string;
  commitPolicy: string;
};

export const Route = createFileRoute("/projects/$id/settings")({
  component: SettingsRoute,
});

function ConfigKeyEditor({ projectId, item }: { projectId: string; item: ConfigItem }) {
  const queryClient = useQueryClient();
  const [value, setValue] = React.useState(item.currentValue ?? "");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setValue(item.currentValue ?? "");
  }, [item.currentValue]);

  const patchM = useMutation({
    mutationFn: async (nextValue: string | null) => {
      setError(null);
      const res = await fetch(`/api/projects/${projectId}/config`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: item.key, value: nextValue }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return nextValue;
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "config"] });
    },
  });

  return (
    <div className="rounded-md border border-card-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{item.label}</p>
          <p className="text-xs text-muted-foreground">{item.description}</p>
        </div>
        <code className="shrink-0 rounded bg-secondary px-2 py-0.5 text-[10px]">{item.key}</code>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={item.defaultValue ?? "(no default)"}
          className="min-w-0 flex-1 py-1"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => patchM.mutate(value)}
          disabled={patchM.isPending || value === (item.currentValue ?? "")}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => patchM.mutate(null)}
          disabled={item.currentValue === null}
        >
          Reset
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
        {item.source && <Badge variant="subtle">{item.source}</Badge>}
        {item.updatedAt && <span>Updated {new Date(item.updatedAt).toLocaleString()}</span>}
        {item.defaultValue && (
          <span className="ml-auto">
            Default: <code>{item.defaultValue}</code>
          </span>
        )}
      </div>
      {error && <SettingsError message={error} className="mt-2" />}
    </div>
  );
}

function DirectivesSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const dirsQ = useQuery({
    queryKey: ["projects", projectId, "directives"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/directives`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: Directive[] };
    },
  });

  const [newScope, setNewScope] = React.useState("pre-review");
  const [newKind, setNewKind] = React.useState<"command" | "rule">("command");
  const [newRepoTarget, setNewRepoTarget] = React.useState("auto");
  const [newTitle, setNewTitle] = React.useState("");
  const [newInstruction, setNewInstruction] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const addM = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await fetch(`/api/projects/${projectId}/directives`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: newScope,
          kind: newKind,
          repoTarget: newRepoTarget,
          title: newTitle,
          instruction: newInstruction,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      setNewTitle("");
      setNewInstruction("");
      setNewRepoTarget("auto");
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "directives"] });
    },
  });

  const toggleM = useMutation({
    mutationFn: async (d: Directive) => {
      const res = await fetch(`/api/projects/${projectId}/directives/${d.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !d.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "directives"] }),
  });

  const runM = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/projects/${projectId}/directives/${id}/run`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { ok: boolean; stderr: string; stdout: string };
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "directives"] }),
  });

  const removeM = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/projects/${projectId}/directives/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "directives"] }),
  });

  const items = dirsQ.data?.items ?? [];
  const byScope = new Map<string, Directive[]>();
  for (const d of items) {
    const arr = byScope.get(d.scope) ?? [];
    arr.push(d);
    byScope.set(d.scope, arr);
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Directives</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Commands and rules the agents enforce at specific moments in the cycle. Blocking directives
        abort the transition (e.g. <code>pre-review</code>) when they fail.
      </p>

      {[...byScope.keys()].sort().map((scope) => (
        <div key={scope} className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {scope}
          </h3>
          <ul className="space-y-2">
            {byScope.get(scope)!.map((d) => (
              <li key={d.id} className="rounded-md border border-card-border bg-card p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.title}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {d.kind}
                  </Badge>
                  {d.kind === "command" && (
                    <Badge variant="subtle" className="text-[10px]">
                      repo: {d.repoTarget}
                    </Badge>
                  )}
                  {d.blocking && (
                    <Badge variant="outline" className="text-[10px]">
                      blocking
                    </Badge>
                  )}
                  {!d.enabled && (
                    <Badge variant="subtle" className="text-[10px]">
                      disabled
                    </Badge>
                  )}
                  {d.lastRunStatus && (
                    <Badge
                      variant={d.lastRunStatus === "ok" ? "statusDone" : "severityCritical"}
                      className="text-[10px]"
                    >
                      {d.lastRunStatus}
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    {d.kind === "command" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => runM.mutate(d.id)}
                        disabled={runM.isPending}
                      >
                        Run
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => toggleM.mutate(d)}>
                      {d.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeM.mutate(d.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
                <pre className="mt-2 overflow-auto rounded bg-secondary/40 px-2 py-1 font-mono text-[11px]">
                  {d.instruction}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="rounded-md border border-dashed border-card-border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Add directive
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs">
            Scope
            <Select value={newScope} onValueChange={(value) => setNewScope(value ?? "")}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {["always", "pre-review", "pre-commit", "pre-doc-sync", "pre-ship", "on-error"].map(
                  (scope) => (
                    <SelectItem key={scope} value={scope}>
                      {scope}
                    </SelectItem>
                  ),
                )}
              </SelectPopup>
            </Select>
          </label>
          <label className="text-xs">
            Kind
            <Select
              value={newKind}
              onValueChange={(value) => setNewKind(value as "command" | "rule")}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="command">command</SelectItem>
                <SelectItem value="rule">rule</SelectItem>
              </SelectPopup>
            </Select>
          </label>
        </div>
        {newKind === "command" && (
          <label className="mt-3 block text-xs">
            Repo target
            <Input
              type="text"
              value={newRepoTarget}
              onChange={(e) => setNewRepoTarget(e.target.value)}
              placeholder="auto | all | workspace | <repo-name>"
              className="mt-1"
            />
          </label>
        )}
        <Input
          type="text"
          placeholder="Title (e.g. Format code)"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="mt-3"
        />
        <Textarea
          placeholder={
            newKind === "command"
              ? "bun run format"
              : "Always update CHANGELOG before request-review"
          }
          value={newInstruction}
          onChange={(e) => setNewInstruction(e.target.value)}
          rows={3}
          className="mt-3"
        />
        {error && <SettingsError message={error} className="mt-2" />}
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            onClick={() => addM.mutate()}
            disabled={!newTitle.trim() || !newInstruction.trim() || addM.isPending}
          >
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}

function ReposSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const reposQ = useQuery({
    queryKey: ["projects", projectId, "repos"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/repos`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: Repo[]; implicit: boolean };
    },
  });

  const [newName, setNewName] = React.useState("");
  const [newPath, setNewPath] = React.useState("");
  const [newBaseBranch, setNewBaseBranch] = React.useState("main");
  const [newPrimary, setNewPrimary] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["projects", projectId, "repos"] });

  const addM = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await fetch(`/api/projects/${projectId}/repos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName,
          path: newPath,
          baseBranch: newBaseBranch,
          isPrimary: newPrimary,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      setNewName("");
      setNewPath("");
      setNewBaseBranch("main");
      setNewPrimary(false);
      void invalidate();
    },
  });

  const patchM = useMutation({
    mutationFn: async ({ id, baseBranch }: { id: string; baseBranch: string }) => {
      const res = await fetch(`/api/projects/${projectId}/repos/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseBranch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => invalidate(),
  });

  const removeM = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/projects/${projectId}/repos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => invalidate(),
  });

  const items = reposQ.data?.items ?? [];
  const implicit = reposQ.data?.implicit ?? false;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Repos</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        The git repos that make up this project. Multi-repo projects register one entry per repo so
        merge anchoring, directives, and diffs target each repo independently.
      </p>

      {implicit ? (
        <div className="mb-4 rounded-md border border-card-border bg-card p-3 text-sm">
          {items.map((r) => (
            <div key={r.name} className="flex items-center gap-2">
              <span className="font-medium">{r.name}</span>
              <Badge variant="subtle" className="text-[10px]">
                implicit
              </Badge>
              <code className="text-[11px] text-muted-foreground">{r.path}</code>
              <code className="ml-auto text-[11px] text-muted-foreground">{r.baseBranch}</code>
            </div>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">
            This project uses a single implicit repo (the current workspace). Add entries here only
            for multi-repo projects.
          </p>
        </div>
      ) : (
        <ul className="mb-4 space-y-2">
          {items.map((r) => (
            <RepoRow
              key={r.id ?? r.name}
              repo={r}
              onSave={(baseBranch) => r.id && patchM.mutate({ id: r.id, baseBranch })}
              onRemove={() => r.id && removeM.mutate(r.id)}
            />
          ))}
        </ul>
      )}

      <div className="rounded-md border border-dashed border-card-border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Add repo
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Input
            type="text"
            placeholder="Name (e.g. api)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            type="text"
            placeholder="Base branch (e.g. main)"
            value={newBaseBranch}
            onChange={(e) => setNewBaseBranch(e.target.value)}
          />
        </div>
        <Input
          type="text"
          placeholder="Path (absolute or relative to the workspace)"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          className="mt-3"
        />
        <label className="mt-3 flex items-center gap-2 text-xs">
          <Checkbox
            checked={newPrimary}
            onCheckedChange={(checked) => setNewPrimary(checked === true)}
          />
          Primary repo
        </label>
        {error && <SettingsError message={error} className="mt-2" />}
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            onClick={() => addM.mutate()}
            disabled={!newName.trim() || !newPath.trim() || addM.isPending}
          >
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}

function RepoRow({
  repo,
  onSave,
  onRemove,
}: {
  repo: Repo;
  onSave: (baseBranch: string) => void;
  onRemove: () => void;
}) {
  const [baseBranch, setBaseBranch] = React.useState(repo.baseBranch);
  React.useEffect(() => {
    setBaseBranch(repo.baseBranch);
  }, [repo.baseBranch]);

  return (
    <li className="rounded-md border border-card-border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{repo.name}</span>
        {repo.isPrimary && (
          <Badge variant="outline" className="text-[10px]">
            primary
          </Badge>
        )}
        <code className="text-[11px] text-muted-foreground">{repo.path}</code>
        <div className="ml-auto flex items-center gap-2">
          <Input
            type="text"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            className="w-40 py-1"
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => onSave(baseBranch)}
            disabled={baseBranch === repo.baseBranch}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
    </li>
  );
}

function ConfigurationSection({ projectId }: { projectId: string }) {
  const configQ = useQuery({
    queryKey: ["projects", projectId, "config"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: ConfigItem[]; knownKeys: string[] };
    },
  });

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">Configuration</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Per-project overrides for the keys depot reads at runtime. Empty fields fall back to the
        listed default.
      </p>
      {configQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {configQ.error && <SettingsError message={(configQ.error as Error).message} />}
      {configQ.data &&
        (configQ.data.items.length === 0 ? (
          <EmptyState message="No configurable keys for this project." />
        ) : (
          <div className="space-y-3">
            {configQ.data.items.map((item) => (
              <ConfigKeyEditor key={item.key} projectId={projectId} item={item} />
            ))}
          </div>
        ))}
    </section>
  );
}

function DocProfilesSection({ projectId }: { projectId: string }) {
  const docsQ = useQuery({
    queryKey: ["projects", projectId, "docs"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/docs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { profiles: DocProfile[] };
    },
  });

  const profiles = docsQ.data?.profiles ?? [];

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">Doc profiles</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        The doc-sync profiles agents use to keep documentation in step with shipped PRDs. Manage
        them from the CLI; the full sync history lives on the project docs page.
      </p>
      {docsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {docsQ.error && <SettingsError message={(docsQ.error as Error).message} />}
      {docsQ.data &&
        (profiles.length === 0 ? (
          <EmptyState
            message="No doc profiles configured."
            action={
              <Link
                to="/projects/$id/docs"
                params={{ id: projectId }}
                className="rounded-md border border-card-border bg-secondary px-3 py-1 text-xs transition-colors hover:bg-accent"
              >
                Open docs page
              </Link>
            }
          />
        ) : (
          <ul className="space-y-2">
            {profiles.map((p) => (
              <li key={p.id} className="rounded-md border border-card-border bg-card p-3 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {p.style}
                  </Badge>
                  <Badge variant="subtle" className="text-[10px]">
                    {p.commitPolicy}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Target: <code>{p.targetRoot}</code> · Language: {p.language}
                </p>
              </li>
            ))}
          </ul>
        ))}
      {profiles.length > 0 && (
        <Link
          to="/projects/$id/docs"
          params={{ id: projectId }}
          className="mt-3 inline-block text-xs text-primary hover:underline"
        >
          View doc artifacts and sync history →
        </Link>
      )}
    </section>
  );
}

function SettingsError({ message, className }: { message: string; className?: string }) {
  return (
    <p
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive",
        className,
      )}
    >
      {message}
    </p>
  );
}

function SettingsRoute() {
  const { id } = Route.useParams();
  const [section, setSection] = React.useState<SettingsSection>("configuration");

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
              <BreadcrumbPage>Project settings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>
      <div className="flex min-h-0 flex-1">
        <SettingsTree active={section} onSelect={setSection} />
        <PageContent className="mx-auto w-full max-w-3xl space-y-8 p-6">
          {section === "configuration" && <ConfigurationSection projectId={id} />}
          {section === "repos" && <ReposSection projectId={id} />}
          {section === "directives" && <DirectivesSection projectId={id} />}
          {section === "doc-profiles" && <DocProfilesSection projectId={id} />}
        </PageContent>
      </div>
    </PageShell>
  );
}
