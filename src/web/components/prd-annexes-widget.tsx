import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon, PaperclipIcon, PlusIcon, XIcon } from "lucide-react";
import * as React from "react";

import { Markdown } from "#/web/components/markdown";
import { Badge } from "#/web/components/ui/badge";
import { Button } from "#/web/components/ui/button";
import { Card } from "#/web/components/ui/card";
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
import { VALID_ANNEX_KINDS, type AnnexKind } from "#/shared/validator";
import type { PrdDetailResponse } from "#/web/lib/api-types";

/**
 * PRD annexes section (PRD 0024 / T2).
 *
 * Lists each annex (name, kind badge, description) and renders a preview keyed
 * on `kind`. Full annex `content` is *not* part of the detail payload — it is
 * fetched on demand per annex via `GET /api/prds/:id/annexes/:annexId` so a
 * revision with large HTML prototypes keeps the detail load cheap.
 *
 * `html` previews render inside a **sandboxed iframe without `allow-scripts`**
 * (PRD 0024 Q7): a static prototype renders fine without JS, and withholding
 * script execution keeps an untrusted annex from running code even on
 * localhost. `markdown` is rendered, `code`/`text` fall back to a `<pre>`.
 */

type AnnexSummary = PrdDetailResponse["annexes"][number];

const KIND_LABEL: Record<AnnexKind, string> = {
  html: "HTML",
  markdown: "Markdown",
  code: "Code",
  text: "Text",
};

function buildAnnexDomId(name: string): string {
  return `annex-${name}`;
}

export function PrdAnnexesSection({
  prdRevisionId,
  annexes,
}: {
  prdRevisionId: string;
  annexes: AnnexSummary[];
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["prds", prdRevisionId] });
  };

  const removeMutation = useMutation({
    mutationFn: async (annexId: string) => {
      setError(null);
      const res = await fetch(`/api/prds/${prdRevisionId}/annexes/${encodeURIComponent(annexId)}`, {
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

  return (
    <section className="space-y-3" data-testid="prd-annexes-section">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <PaperclipIcon className="size-3.5" />
          Annexes
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setAdding((open) => !open)}
          aria-label={adding ? "Cancel adding annex" : "Add annex"}
        >
          {adding ? <XIcon className="size-3" /> : <PlusIcon className="size-3" />}
          <span className="ml-1">{adding ? "Cancel" : "Add"}</span>
        </Button>
      </div>

      {adding ? (
        <AnnexAddForm
          prdRevisionId={prdRevisionId}
          onDone={() => {
            setAdding(false);
            invalidate();
          }}
        />
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {annexes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No annexes attached to this revision.</p>
      ) : (
        <ul className="space-y-4" aria-label="PRD annexes">
          {annexes.map((annex) => (
            <li key={annex.id} id={buildAnnexDomId(annex.name)}>
              <AnnexCard
                prdRevisionId={prdRevisionId}
                annex={annex}
                onRemove={() => removeMutation.mutate(annex.id)}
                removing={removeMutation.isPending}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AnnexCard({
  prdRevisionId,
  annex,
  onRemove,
  removing,
}: {
  prdRevisionId: string;
  annex: AnnexSummary;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <Card className="gap-3 border border-card-border p-4" data-testid="annex-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium text-foreground">{annex.name}</span>
            <Badge variant="subtle" className="gap-1" data-testid="annex-kind-badge">
              {KIND_LABEL[annex.kind]}
            </Badge>
          </div>
          {annex.description ? (
            <p className="text-xs text-muted-foreground">{annex.description}</p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove annex ${annex.name}`}
          onClick={onRemove}
          disabled={removing}
        >
          <XIcon className="size-3" />
        </Button>
      </div>
      <AnnexPreview prdRevisionId={prdRevisionId} annex={annex} />
    </Card>
  );
}

function AnnexPreview({ prdRevisionId, annex }: { prdRevisionId: string; annex: AnnexSummary }) {
  const contentQuery = useQuery({
    queryKey: ["prds", prdRevisionId, "annexes", annex.id],
    queryFn: async (): Promise<string> => {
      const res = await fetch(`/api/prds/${prdRevisionId}/annexes/${encodeURIComponent(annex.id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { annex: { content: string } };
      return body.annex.content;
    },
  });

  if (contentQuery.isLoading) {
    return <p className="text-xs text-muted-foreground">Loading preview…</p>;
  }
  if (contentQuery.isError || contentQuery.data == null) {
    return <p className="text-xs text-destructive">Could not load annex content.</p>;
  }

  const content = contentQuery.data;

  if (annex.kind === "html") {
    return (
      <iframe
        title={`Annex preview: ${annex.name}`}
        data-testid="annex-html-iframe"
        sandbox=""
        srcDoc={content}
        className="h-64 w-full rounded-md border border-card-border bg-white"
      />
    );
  }

  if (annex.kind === "markdown") {
    return (
      <div className="max-h-64 overflow-auto rounded-md border border-card-border bg-muted/20 p-3">
        <Markdown source={content} className="text-xs leading-5 text-secondary-foreground" />
      </div>
    );
  }

  // code + text both render verbatim; `code` keeps a mono font for alignment.
  return (
    <pre
      data-testid="annex-pre"
      className={cn(
        "max-h-64 overflow-auto rounded-md border border-card-border bg-muted/30 p-3",
        "whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground",
      )}
    >
      {content}
    </pre>
  );
}

function AnnexAddForm({ prdRevisionId, onDone }: { prdRevisionId: string; onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<AnnexKind>("html");
  const [description, setDescription] = React.useState("");
  const [content, setContent] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await fetch(`/api/prds/${prdRevisionId}/annexes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          description: description.trim() === "" ? null : description.trim(),
          content,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: onDone,
    onError: (e) => setError((e as Error).message),
  });

  const onFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setContent(text);
  };

  return (
    <form
      className="space-y-2 rounded-md border border-card-border bg-muted/10 p-3"
      data-testid="annex-add-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim().length === 0 || content.length === 0) return;
        addMutation.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="annex-name" className="sr-only">
          Annex name
        </label>
        <Input
          id="annex-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="kebab-case name"
          aria-label="Annex name"
          className="h-7 flex-1 text-xs font-mono"
        />
        <label htmlFor="annex-kind" className="sr-only">
          Annex kind
        </label>
        <Select
          value={kind}
          onValueChange={(value) => {
            if (value) setKind(value as AnnexKind);
          }}
        >
          <SelectTrigger
            id="annex-kind"
            aria-label="Annex kind"
            className="min-h-7 w-28 px-2 py-1 text-xs"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {VALID_ANNEX_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <label htmlFor="annex-description" className="sr-only">
        Annex description
      </label>
      <Input
        id="annex-description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="description (optional)"
        aria-label="Annex description"
        className="h-7 w-full text-xs"
      />
      <label htmlFor="annex-content" className="sr-only">
        Annex content
      </label>
      <Textarea
        id="annex-content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Paste annex content, or upload a file below"
        aria-label="Annex content"
        rows={6}
        className="font-mono text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileTextIcon className="size-3.5" />
          <span>Upload file</span>
          <input
            type="file"
            aria-label="Upload annex file"
            className="text-xs"
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <Button
          type="submit"
          size="sm"
          disabled={addMutation.isPending || name.trim().length === 0 || content.length === 0}
        >
          <PlusIcon className="size-3" />
          Add annex
        </Button>
      </div>
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Render PRD body text, turning inline `[annex: <name>]` mentions into clickable
 * chips (PRD 0024 / T2). Each chip scrolls to the matching annex card; a mention
 * with no matching annex renders as a muted "broken" chip. The surrounding prose
 * is rendered as markdown so a body segment between two mentions keeps its
 * formatting.
 */
const ANNEX_MENTION = /\[annex:\s*([a-z0-9-]+)\]/g;

export function AnnexBodyMarkdown({
  source,
  annexNames,
  className,
}: {
  source: string;
  annexNames: ReadonlySet<string>;
  className?: string;
}) {
  const segments: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of source.matchAll(ANNEX_MENTION)) {
    const start = match.index ?? 0;
    const name = match[1]!;
    if (start > lastIndex) {
      const chunk = source.slice(lastIndex, start);
      segments.push(<Markdown key={`md-${key++}`} source={chunk} className={className} />);
    }
    segments.push(<AnnexChip key={`chip-${key++}`} name={name} known={annexNames.has(name)} />);
    lastIndex = start + match[0].length;
  }
  if (lastIndex < source.length) {
    segments.push(
      <Markdown key={`md-${key++}`} source={source.slice(lastIndex)} className={className} />,
    );
  }

  return <div className="space-y-1">{segments}</div>;
}

function AnnexChip({ name, known }: { name: string; known: boolean }) {
  if (!known) {
    return (
      <span
        data-testid="annex-chip-broken"
        title={`No annex named '${name}' on this revision`}
        className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-1.5 py-0.5 align-middle text-xs text-muted-foreground line-through"
      >
        <PaperclipIcon className="size-2.5" />
        {name}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="annex-chip"
      onClick={() => {
        const target = document.getElementById(buildAnnexDomId(name));
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 align-middle text-xs font-medium text-primary transition-colors hover:bg-primary/20"
    >
      <PaperclipIcon className="size-2.5" />
      {name}
    </button>
  );
}
