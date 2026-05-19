import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Button } from "#/web/components/ui/button";
import { Badge } from "#/web/components/ui/badge";
import { Input } from "#/web/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";
import { Textarea } from "#/web/components/ui/textarea";

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
  blocking: boolean;
  position: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: "ok" | "fail" | null;
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
      {error && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
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
        {error && (
          <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}
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

type SettingsSection = "configuration" | "directives";

function SettingsTree({
  active,
  onSelect,
}: {
  active: SettingsSection;
  onSelect: (s: SettingsSection) => void;
}) {
  return (
    <nav className="w-56 shrink-0 border-r border-card-border bg-card p-3 text-sm">
      <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Settings
      </p>
      <button
        type="button"
        onClick={() => onSelect("configuration")}
        className={
          "mt-1 block w-full rounded-md px-2 py-1.5 text-left transition-colors " +
          (active === "configuration"
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/60 hover:text-foreground")
        }
      >
        Configuration
      </button>
      <button
        type="button"
        onClick={() => onSelect("directives")}
        className={
          "block w-full rounded-md px-2 py-1.5 text-left transition-colors " +
          (active === "directives"
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/60 hover:text-foreground")
        }
      >
        Directives
      </button>
    </nav>
  );
}

function SettingsRoute() {
  const { id } = Route.useParams();
  const [section, setSection] = React.useState<SettingsSection>("configuration");
  const configQ = useQuery({
    queryKey: ["projects", id, "config"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${id}/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: ConfigItem[]; knownKeys: string[] };
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
              <BreadcrumbPage>Project settings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>
      <div className="flex min-h-0 flex-1">
        <SettingsTree active={section} onSelect={setSection} />
        <PageContent className="mx-auto w-full max-w-3xl space-y-8 p-6">
          {section === "configuration" && (
            <section>
              <h2 className="mb-3 text-sm font-semibold">Configuration</h2>
              <div className="space-y-3">
                {configQ.data?.items.map((item) => (
                  <ConfigKeyEditor key={item.key} projectId={id} item={item} />
                ))}
              </div>
            </section>
          )}
          {section === "directives" && <DirectivesSection projectId={id} />}
        </PageContent>
      </div>
    </PageShell>
  );
}
