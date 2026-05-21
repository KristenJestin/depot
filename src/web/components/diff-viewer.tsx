import { PatchDiff, type DiffLineAnnotation } from "@pierre/diffs/react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";

import { Button } from "#/web/components/ui/button";
import { Checkbox } from "#/web/components/ui/checkbox";
import { Textarea } from "#/web/components/ui/textarea";
import { cn } from "#/web/lib/utils";

export type DiffAnnotationKind = "finding" | "deferred-question";

/** Which side of the diff an annotation is anchored to. `del` lines only have
 * an old-file line number, `add`/`context` lines have a new-file line number. */
export type DiffAnnotationSide = "add" | "context" | "del";

export type DiffAnnotation = {
  filePath: string;
  /** Line number on the anchored side: new-file number for `add`/`context`,
   * old-file number for `del`. */
  startLine: number;
  endLine: number;
  text: string;
  kind: DiffAnnotationKind;
  side: DiffAnnotationSide;
};

/** A single file's slice of a unified git diff. */
type ParsedFile = {
  filePath: string;
  patch: string;
  additions: number;
  deletions: number;
};

/**
 * Splits a multi-file unified git diff into one patch string per file. Each
 * `@pierre/diffs` `PatchDiff` renders a single file, so a multi-file diff is
 * sliced on the `diff --git` boundaries before rendering.
 */
function splitDiffByFile(diff: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let current: { filePath: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const patch = current.lines.join("\n");
    let additions = 0;
    let deletions = 0;
    for (const line of current.lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
    files.push({ filePath: current.filePath, patch, additions, deletions });
    current = null;
  };
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git")) {
      flush();
      const match = raw.match(/ b\/(.+)$/);
      current = { filePath: match?.[1] ?? "(unknown)", lines: [raw] };
      continue;
    }
    if (current) current.lines.push(raw);
  }
  flush();
  return files;
}

/** Maps our annotation side to `@pierre/diffs`' addition/deletion side. */
function pierreSide(side: DiffAnnotationSide): "additions" | "deletions" {
  return side === "del" ? "deletions" : "additions";
}

export interface DiffViewerProps {
  diff: string;
  annotations: DiffAnnotation[];
  onAnnotationsChange: (next: DiffAnnotation[]) => void;
}

export function DiffViewer({ diff, annotations, onAnnotationsChange }: DiffViewerProps) {
  const files = React.useMemo(() => splitDiffByFile(diff), [diff]);

  if (files.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No diff against HEAD. The working tree is clean.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {files.map((file) => (
        <FilePanel
          key={file.filePath}
          file={file}
          annotations={annotations.filter((a) => a.filePath === file.filePath)}
          onAnnotationsChange={(forFile) => {
            const others = annotations.filter((a) => a.filePath !== file.filePath);
            onAnnotationsChange([...others, ...forFile]);
          }}
        />
      ))}
    </div>
  );
}

/** Metadata carried on a `@pierre/diffs` line annotation so the renderer can
 * tell saved annotations apart from the in-progress comment editor. */
type AnnotationMeta =
  | { kind: "saved"; annotation: DiffAnnotation }
  | { kind: "pending"; side: DiffAnnotationSide };

type PendingComment = {
  side: DiffAnnotationSide;
  lineNumber: number;
  text: string;
  kind: DiffAnnotationKind;
};

function FilePanel({
  file,
  annotations,
  onAnnotationsChange,
}: {
  file: ParsedFile;
  annotations: DiffAnnotation[];
  onAnnotationsChange: (next: DiffAnnotation[]) => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [pending, setPending] = React.useState<PendingComment | null>(null);

  const lineAnnotations = React.useMemo<DiffLineAnnotation<AnnotationMeta>[]>(() => {
    const list: DiffLineAnnotation<AnnotationMeta>[] = annotations.map((a) => ({
      side: pierreSide(a.side),
      lineNumber: a.startLine,
      metadata: { kind: "saved", annotation: a },
    }));
    if (pending) {
      list.push({
        side: pierreSide(pending.side),
        lineNumber: pending.lineNumber,
        metadata: { kind: "pending", side: pending.side },
      });
    }
    return list;
  }, [annotations, pending]);

  const submit = () => {
    if (!pending || !pending.text.trim()) return;
    onAnnotationsChange([
      ...annotations,
      {
        filePath: file.filePath,
        startLine: pending.lineNumber,
        endLine: pending.lineNumber,
        text: pending.text.trim(),
        kind: pending.kind,
        side: pending.side,
      },
    ]);
    setPending(null);
  };

  const removeAnnotation = (target: DiffAnnotation) => {
    onAnnotationsChange(annotations.filter((a) => a !== target));
  };

  const renderAnnotation = (annotation: DiffLineAnnotation<AnnotationMeta>): React.ReactNode => {
    const meta = annotation.metadata;
    if (!meta) return null;
    if (meta.kind === "pending") {
      return (
        <PendingCommentEditor
          pending={pending}
          onChange={setPending}
          onSubmit={submit}
          onCancel={() => setPending(null)}
        />
      );
    }
    const saved = meta.annotation;
    return (
      <div
        className={cn(
          "px-3 py-2 font-sans text-xs",
          saved.kind === "deferred-question"
            ? "bg-amber-500/10 text-amber-200"
            : "bg-orange-500/10 text-orange-200",
        )}
      >
        <span className="mr-2 inline-flex items-center rounded bg-card-border/40 px-1.5 py-0.5 text-[10px]">
          {saved.kind === "deferred-question" ? "?" : "!"}
        </span>
        {saved.text}
        <button
          type="button"
          className="ml-3 text-[10px] underline opacity-70 hover:opacity-100"
          onClick={() => removeAnnotation(saved)}
        >
          remove
        </button>
      </div>
    );
  };

  return (
    <div
      data-file-path={file.filePath}
      className="overflow-hidden rounded-lg border border-card-border bg-card"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 border-b border-card-border bg-secondary/40 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-secondary/60"
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3.5 shrink-0" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0" />
        )}
        <span className="truncate font-mono text-xs">{file.filePath}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px] tabular-nums">
          <span className="text-emerald-400">+{file.additions}</span>
          <span className="text-rose-400">−{file.deletions}</span>
        </span>
      </button>
      {!collapsed && (
        <PatchDiff<AnnotationMeta>
          patch={file.patch}
          disableWorkerPool
          lineAnnotations={lineAnnotations}
          renderAnnotation={renderAnnotation}
          options={{
            disableFileHeader: true,
            diffStyle: "unified",
            diffIndicators: "classic",
            hunkSeparators: "simple",
            overflow: "wrap",
            lineHoverHighlight: "both",
            onLineNumberClick: ({ lineNumber, annotationSide }) => {
              setPending({
                side: annotationSide === "deletions" ? "del" : "add",
                lineNumber,
                text: "",
                kind: "finding",
              });
            },
          }}
        />
      )}
    </div>
  );
}

function PendingCommentEditor({
  pending,
  onChange,
  onSubmit,
  onCancel,
}: {
  pending: PendingComment | null;
  onChange: (next: PendingComment) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (!pending) return null;
  return (
    <div className="bg-secondary/30 px-3 py-3">
      <Textarea
        value={pending.text}
        onChange={(e) => onChange({ ...pending, text: e.target.value })}
        className="font-sans text-xs"
        rows={3}
        placeholder={
          pending.side === "del" ? "What's wrong with this removed line?" : "What's wrong here?"
        }
        autoFocus
      />
      <div className="mt-2 flex items-center gap-3">
        <label className="flex items-center gap-2 font-sans text-[11px] text-muted-foreground">
          <Checkbox
            checked={pending.kind === "deferred-question"}
            onCheckedChange={(checked) =>
              onChange({ ...pending, kind: checked ? "deferred-question" : "finding" })
            }
          />
          I'm asking, not flagging (deferred?)
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={!pending.text.trim()}>
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}
