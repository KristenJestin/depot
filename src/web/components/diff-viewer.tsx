import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import * as React from "react";

import { Button } from "#/web/components/ui/button";
import { Checkbox } from "#/web/components/ui/checkbox";
import { Textarea } from "#/web/components/ui/textarea";
import { highlightLine } from "#/web/lib/highlight";
import { cn } from "#/web/lib/utils";

export type DiffAnnotationKind = "finding" | "deferred-question";

export type DiffAnnotation = {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  kind: DiffAnnotationKind;
  /** Which side the annotation is anchored to. `del` lines have no
   * new-file line number, so we anchor them by their position in the hunk. */
  side: "add" | "context" | "del";
  /** Anchor index inside the hunk's line array — stable enough for
   * unstaged diff review (we don't try to track lines across rebases). */
  anchorIndex: number;
};

type DiffLine = {
  type: "context" | "add" | "del" | "header";
  text: string;
  /** New-file line number for context/add; null for del/header. */
  newLineNumber: number | null;
  /** Old-file line number for context/del; null for add/header. */
  oldLineNumber: number | null;
};

type ParsedHunk = {
  filePath: string;
  lines: DiffLine[];
};

type LineSelection = {
  startAnchorIndex: number;
  endAnchorIndex: number;
} | null;

type PendingAnnotation = {
  startAnchorIndex: number;
  endAnchorIndex: number;
  text: string;
  kind: DiffAnnotationKind;
};

function parseUnifiedDiff(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  let newLine = 0;
  let oldLine = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git")) {
      if (current) hunks.push(current);
      const match = raw.match(/b\/(.+)$/);
      current = { filePath: match?.[1] ?? "(unknown)", lines: [] };
      newLine = 0;
      oldLine = 0;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("@@")) {
      const m = raw.match(/-(\d+)(?:,\d+)? \+(\d+)/);
      oldLine = m ? Number(m[1]) - 1 : 0;
      newLine = m ? Number(m[2]) - 1 : 0;
      current.lines.push({
        type: "header",
        text: raw,
        newLineNumber: null,
        oldLineNumber: null,
      });
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("index ")) continue;
    if (raw.startsWith("+")) {
      newLine += 1;
      current.lines.push({
        type: "add",
        text: raw.slice(1),
        newLineNumber: newLine,
        oldLineNumber: null,
      });
    } else if (raw.startsWith("-")) {
      oldLine += 1;
      current.lines.push({
        type: "del",
        text: raw.slice(1),
        newLineNumber: null,
        oldLineNumber: oldLine,
      });
    } else {
      // context line starts with a space (or nothing for empty)
      const text = raw.startsWith(" ") ? raw.slice(1) : raw;
      newLine += 1;
      oldLine += 1;
      current.lines.push({
        type: "context",
        text,
        newLineNumber: newLine,
        oldLineNumber: oldLine,
      });
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

export interface DiffViewerProps {
  diff: string;
  annotations: DiffAnnotation[];
  onAnnotationsChange: (next: DiffAnnotation[]) => void;
}

export function DiffViewer({ diff, annotations, onAnnotationsChange }: DiffViewerProps) {
  const hunks = React.useMemo(() => parseUnifiedDiff(diff), [diff]);

  if (hunks.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No diff against HEAD. The working tree is clean.
      </div>
    );
  }

  return (
    <div className="space-y-4 font-mono text-xs">
      {hunks.map((hunk) => (
        <FileHunk
          key={hunk.filePath}
          hunk={hunk}
          annotations={annotations.filter((a) => a.filePath === hunk.filePath)}
          onAnnotationsChange={(forFile) => {
            // Replace annotations for this file, keep others as-is.
            const others = annotations.filter((a) => a.filePath !== hunk.filePath);
            onAnnotationsChange([...others, ...forFile]);
          }}
        />
      ))}
    </div>
  );
}

function lineNumberForAnnotation(line: DiffLine): number | null {
  return line.newLineNumber ?? line.oldLineNumber;
}

function findAnnotationEndAnchor(lines: DiffLine[], annotation: DiffAnnotation): number {
  let end = annotation.anchorIndex;
  for (let i = annotation.anchorIndex; i < lines.length; i++) {
    const number = lineNumberForAnnotation(lines[i]!);
    if (number === null) continue;
    if (number > annotation.endLine) break;
    end = i;
  }
  return end;
}

function FileHunk({
  hunk,
  annotations,
  onAnnotationsChange,
}: {
  hunk: ParsedHunk;
  annotations: DiffAnnotation[];
  onAnnotationsChange: (next: DiffAnnotation[]) => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [pending, setPending] = React.useState<PendingAnnotation | null>(null);
  const [selection, setSelection] = React.useState<LineSelection>(null);
  const [dragging, setDragging] = React.useState(false);
  const additions = hunk.lines.filter((l) => l.type === "add").length;
  const deletions = hunk.lines.filter((l) => l.type === "del").length;

  const submit = () => {
    if (!pending || !pending.text.trim()) return;
    const startAnchorIndex = Math.min(pending.startAnchorIndex, pending.endAnchorIndex);
    const endAnchorIndex = Math.max(pending.startAnchorIndex, pending.endAnchorIndex);
    const lines = hunk.lines
      .slice(startAnchorIndex, endAnchorIndex + 1)
      .filter((line): line is Exclude<DiffLine, { type: "header" }> => line.type !== "header");
    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];
    if (!firstLine || !lastLine) return;
    const startLine = firstLine.newLineNumber ?? firstLine.oldLineNumber ?? 0;
    const endLine = lastLine.newLineNumber ?? lastLine.oldLineNumber ?? startLine;
    const side: DiffAnnotation["side"] =
      firstLine.type === "add" || firstLine.type === "del" ? firstLine.type : "context";
    onAnnotationsChange([
      ...annotations,
      {
        filePath: hunk.filePath,
        startLine,
        endLine,
        text: pending.text.trim(),
        kind: pending.kind,
        side,
        anchorIndex: startAnchorIndex,
      },
    ]);
    setPending(null);
    setSelection(null);
  };

  const selectionBounds = selection
    ? {
        start: Math.min(selection.startAnchorIndex, selection.endAnchorIndex),
        end: Math.max(selection.startAnchorIndex, selection.endAnchorIndex),
      }
    : null;

  const startSelection = (anchorIndex: number, extend: boolean) => {
    setSelection((current) => ({
      startAnchorIndex: extend && current ? current.startAnchorIndex : anchorIndex,
      endAnchorIndex: anchorIndex,
    }));
  };

  const openAnnotation = (anchorIndex: number) => {
    const range =
      selectionBounds && anchorIndex >= selectionBounds.start && anchorIndex <= selectionBounds.end
        ? selectionBounds
        : { start: anchorIndex, end: anchorIndex };
    setPending({
      startAnchorIndex: range.start,
      endAnchorIndex: range.end,
      text: "",
      kind: "finding",
    });
  };

  React.useEffect(() => {
    if (!dragging) return;
    const stopDragging = () => setDragging(false);
    window.addEventListener("mouseup", stopDragging);
    return () => window.removeEventListener("mouseup", stopDragging);
  }, [dragging]);

  return (
    <Collapsible.Root
      open={!collapsed}
      onOpenChange={(o) => setCollapsed(!o)}
      data-file-path={hunk.filePath}
      className="overflow-hidden rounded-lg border border-card-border bg-card"
    >
      <Collapsible.Trigger className="flex w-full items-center gap-2 border-b border-card-border bg-secondary/40 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-secondary/60">
        {collapsed ? (
          <ChevronRightIcon className="size-3.5 shrink-0" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{hunk.filePath}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px] tabular-nums">
          <span className="text-emerald-400">+{additions}</span>
          <span className="text-rose-400">−{deletions}</span>
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="data-[ending-style]:animate-out data-[starting-style]:animate-in">
        <div>
          {hunk.lines.map((line, i) => {
            const ann = annotations.find((a) => a.anchorIndex === i);
            const rangeAnn = annotations.find((a) => {
              const start = a.anchorIndex;
              const end = findAnnotationEndAnchor(hunk.lines, a);
              return i >= start && i <= end;
            });
            const isSelected =
              selectionBounds !== null && i >= selectionBounds.start && i <= selectionBounds.end;
            const pendingCount = pending
              ? Math.abs(pending.endAnchorIndex - pending.startAnchorIndex) + 1
              : 1;
            return (
              <React.Fragment key={`${hunk.filePath}-${i}`}>
                <DiffRow
                  line={line}
                  filePath={hunk.filePath}
                  hasAnnotation={Boolean(rangeAnn)}
                  selected={isSelected}
                  onLineMouseDown={(event) => {
                    event.preventDefault();
                    startSelection(i, event.shiftKey);
                    setDragging(true);
                  }}
                  onLineMouseEnter={() => {
                    if (dragging) {
                      setSelection((current) =>
                        current ? { ...current, endAnchorIndex: i } : current,
                      );
                    }
                  }}
                  onAdd={() => openAnnotation(i)}
                />
                {pending && pending.endAnchorIndex === i && (
                  <div className="bg-secondary/30 px-3 py-3">
                    <Textarea
                      value={pending.text}
                      onChange={(e) => setPending({ ...pending, text: e.target.value })}
                      className="font-sans text-xs"
                      rows={3}
                      placeholder={
                        pendingCount > 1
                          ? `What's wrong across these ${pendingCount} lines?`
                          : "What's wrong here?"
                      }
                      autoFocus
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <label className="flex items-center gap-2 font-sans text-[11px] text-muted-foreground">
                        <Checkbox
                          checked={pending.kind === "deferred-question"}
                          onCheckedChange={(checked) =>
                            setPending({
                              ...pending,
                              kind: checked ? "deferred-question" : "finding",
                            })
                          }
                        />
                        I'm asking, not flagging (deferred?)
                      </label>
                      <div className="ml-auto flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={submit} disabled={!pending.text.trim()}>
                          Submit
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {ann && (
                  <div
                    className={cn(
                      "px-3 py-2 font-sans text-xs",
                      ann.kind === "deferred-question"
                        ? "bg-amber-500/10 text-amber-200"
                        : "bg-orange-500/10 text-orange-200",
                    )}
                  >
                    <span className="mr-2 inline-flex items-center rounded bg-card-border/40 px-1.5 py-0.5 text-[10px]">
                      {ann.kind === "deferred-question" ? "?" : "!"}
                    </span>
                    {ann.text}
                    <button
                      type="button"
                      className="ml-3 text-[10px] underline opacity-70 hover:opacity-100"
                      onClick={() => onAnnotationsChange(annotations.filter((a) => a !== ann))}
                    >
                      remove
                    </button>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function DiffRow({
  line,
  filePath,
  hasAnnotation,
  selected,
  onLineMouseDown,
  onLineMouseEnter,
  onAdd,
}: {
  line: DiffLine;
  filePath: string;
  hasAnnotation: boolean;
  selected: boolean;
  onLineMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onLineMouseEnter: () => void;
  onAdd: () => void;
}) {
  const [html, setHtml] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (line.type === "header") return;
    let cancelled = false;
    void highlightLine(line.text, filePath).then((next) => {
      if (!cancelled) setHtml(next);
    });
    return () => {
      cancelled = true;
    };
  }, [line.text, line.type, filePath]);

  if (line.type === "header") {
    return (
      <div className="flex items-start gap-2 bg-secondary/30 px-3 py-0.5 italic text-muted-foreground">
        <pre className="flex-1 whitespace-pre-wrap break-all leading-tight">{line.text}</pre>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-2 px-3 leading-snug transition-colors",
        line.type === "add" && "bg-emerald-500/10",
        line.type === "del" && "bg-rose-500/10",
        selected && "bg-primary/15 ring-1 ring-inset ring-primary/30",
      )}
      onMouseEnter={onLineMouseEnter}
    >
      <button
        type="button"
        className="w-8 shrink-0 select-none text-right text-[10px] text-muted-foreground/70 hover:text-foreground"
        onMouseDown={onLineMouseDown}
        title="Click, drag, or Shift-click to select lines"
      >
        {line.oldLineNumber ?? ""}
      </button>
      <button
        type="button"
        className="w-8 shrink-0 select-none text-right text-[10px] text-muted-foreground/70 hover:text-foreground"
        onMouseDown={onLineMouseDown}
        title="Click, drag, or Shift-click to select lines"
      >
        {line.newLineNumber ?? ""}
      </button>
      <span
        className={cn(
          "w-3 shrink-0 select-none text-center font-bold",
          line.type === "add" && "text-emerald-400",
          line.type === "del" && "text-rose-400",
        )}
      >
        {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
      </span>
      <pre
        className="flex-1 whitespace-pre-wrap break-all leading-tight"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html ?? line.text }}
      />
      {!hasAnnotation && (
        <button
          type="button"
          onClick={onAdd}
          className="invisible shrink-0 self-center rounded bg-primary/20 p-0.5 text-primary-foreground hover:bg-primary/30 group-hover:visible"
          aria-label="Add comment"
        >
          <PlusIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
