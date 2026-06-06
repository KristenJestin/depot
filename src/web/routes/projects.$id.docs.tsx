import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Badge } from "#/web/components/ui/badge";
import { Button, buttonVariants } from "#/web/components/ui/button";
import { EmptyState } from "#/web/components/ui/empty-state";
import { cn } from "#/web/lib/utils";

type Artifact = {
  id: string;
  kind: string;
  path: string;
  absPath: string | null;
  number: number | null;
  title: string;
  status: string | null;
  supersededBy: string | null;
  linkedPrdRevisionId: string | null;
  lastModifiedAt: string;
  lastModifiedBySource: string;
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

type SyncRun = {
  id: string;
  ranAt: string;
  sinceRef: string | null;
  untilRef: string | null;
  triggeredByPrdId: string | null;
  filesChanged: string;
};

/**
 * Fallback editor URL scheme when no `defaultEditor` config is set. Resolves to
 * VS Code's `vscode://file/<abs-path>` handler, which Cursor and other VS Code
 * forks also register.
 */
const DEFAULT_EDITOR_SCHEME = "vscode://file/";

/**
 * Build the editor deep-link for a resolved absolute path. `defaultEditor` is a
 * URL-scheme prefix (e.g. `vscode://file/` or `cursor://file/`); the absolute
 * path is appended verbatim. Returns null when the path could not be resolved
 * (e.g. the workspace is unknown), so callers can hide the action.
 */
export function buildEditorUrl(
  absPath: string | null,
  defaultEditor: string | null,
): string | null {
  if (!absPath) return null;
  const scheme =
    defaultEditor && defaultEditor.trim().length > 0 ? defaultEditor : DEFAULT_EDITOR_SCHEME;
  return `${scheme}${absPath}`;
}

export const Route = createFileRoute("/projects/$id/docs")({
  component: DocsRoute,
});

function DocsRoute() {
  const { id } = Route.useParams();
  const docsQ = useQuery({
    queryKey: ["projects", id, "docs"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${id}/docs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as {
        artifacts: Artifact[];
        profiles: DocProfile[];
        lastRunsByProfile: Record<string, SyncRun[]>;
        defaultEditor: string | null;
      };
    },
  });

  const data = docsQ.data;
  const adrs = data?.artifacts.filter((a) => a.kind === "adr") ?? [];
  const contexts = data?.artifacts.filter((a) => a.kind === "context") ?? [];
  const glossaries = data?.artifacts.filter((a) => a.kind === "glossary") ?? [];
  const freeforms = data?.artifacts.filter((a) => a.kind === "freeform") ?? [];
  const defaultEditor = data?.defaultEditor ?? null;

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
              <BreadcrumbPage>Docs</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>
      <PageContent className="mx-auto w-full max-w-4xl space-y-8 p-6">
        {docsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {docsQ.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {(docsQ.error as Error).message}
          </p>
        )}

        {data && (
          <>
            {data.artifacts.length === 0 && (
              <EmptyState message="No documentation artifacts yet. Run `depot doc sync` to generate docs from shipped PRDs." />
            )}
            <ArtifactSection title="Architecture Decision Records (ADR)" items={adrs} />
            <ArtifactSection title="CONTEXT" items={contexts} />
            <ArtifactSection title="Glossary" items={glossaries} />
            <ArtifactSection
              title="Freeform docs"
              items={freeforms}
              defaultEditor={defaultEditor}
            />

            <section>
              <h2 className="mb-3 text-sm font-semibold">Doc profiles</h2>
              {data.profiles.length === 0 ? (
                <EmptyState message="No doc profiles configured. Run `depot doc profile create <name>` to create one." />
              ) : (
                <ul className="space-y-3">
                  {data.profiles.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-md border border-card-border bg-card p-4 text-sm"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="font-medium">{p.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {p.style}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Target: <code>{p.targetRoot}</code> · Language: {p.language} · Commit:{" "}
                        {p.commitPolicy}
                      </p>
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          Sources / guardrails
                        </summary>
                        <pre className="mt-2 overflow-auto rounded bg-secondary/40 p-2 text-[11px]">
                          {`sources: ${p.sources}\nguardrails: ${p.guardrails}`}
                        </pre>
                      </details>
                      <SyncHistory runs={data.lastRunsByProfile[p.id] ?? []} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </PageContent>
    </PageShell>
  );
}

function ArtifactSection({
  title,
  items,
  defaultEditor = null,
}: {
  title: string;
  items: Artifact[];
  defaultEditor?: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="rounded-md border border-card-border bg-card p-3 text-sm">
            <div className="flex items-baseline gap-2">
              {a.number !== null && (
                <span className="font-mono text-xs text-muted-foreground">
                  #{String(a.number).padStart(4, "0")}
                </span>
              )}
              <span className="font-medium">{a.title}</span>
              {a.status && (
                <Badge variant="outline" className="text-[10px]">
                  {a.status}
                </Badge>
              )}
              {a.supersededBy && (
                <Badge variant="subtle" className="text-[10px]">
                  superseded
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <code>{a.path}</code> · last modified by {a.lastModifiedBySource}{" "}
              {new Date(a.lastModifiedAt).toLocaleString()}
            </p>
            {a.linkedPrdRevisionId && (
              <p className="mt-1 text-xs">
                <Link
                  to="/prds/$id"
                  params={{ id: a.linkedPrdRevisionId }}
                  className="text-primary underline"
                >
                  ↳ PRD that motivated this doc
                </Link>
              </p>
            )}
            {a.kind === "freeform" && (
              <FreeformDocActions artifact={a} defaultEditor={defaultEditor} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Open-in-editor + copy-path actions for a freeform doc row (PRD 0021 / T4).
 *
 * "Open in editor" is a real anchor pointing at the configured editor's
 * `<scheme><abs-path>` URL (default `vscode://file/`), so the browser hands the
 * file off to the desktop editor. "Copy path" writes the resolved absolute path
 * to the clipboard. Both are hidden when the absolute path could not be
 * resolved (e.g. the workspace folder is gone).
 */
export function FreeformDocActions({
  artifact,
  defaultEditor = null,
}: {
  artifact: Pick<Artifact, "absPath">;
  defaultEditor?: string | null;
}) {
  const [copied, setCopied] = React.useState(false);
  const absPath = artifact.absPath;
  const editorUrl = buildEditorUrl(absPath, defaultEditor);

  const onCopy = React.useCallback(() => {
    if (!absPath) return;
    void navigator.clipboard
      .writeText(absPath)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => setCopied(false));
  }, [absPath]);

  if (!absPath || !editorUrl) {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground">
        File path could not be resolved (no workspace on disk).
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <a
        href={editorUrl}
        title={`Open ${absPath} in editor`}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
      >
        Open in editor
      </a>
      <Button variant="ghost" size="sm" onClick={onCopy} title={absPath}>
        {copied ? "Copied!" : "Copy path"}
      </Button>
    </div>
  );
}

function SyncHistory({ runs }: { runs: SyncRun[] }) {
  if (runs.length === 0) return null;
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Sync history ({runs.length})
      </summary>
      <ul className="mt-2 space-y-1">
        {runs.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-[11px]">
            <span>{new Date(r.ranAt).toLocaleString()}</span>
            <span className="text-muted-foreground">since={r.sinceRef ?? "—"}</span>
            {r.triggeredByPrdId && (
              <Link
                to="/prds/$id"
                params={{ id: r.triggeredByPrdId }}
                className="text-primary underline"
              >
                PRD
              </Link>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
