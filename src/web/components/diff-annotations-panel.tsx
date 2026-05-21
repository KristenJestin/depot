import { XIcon } from "lucide-react";

import type { DiffAnnotation } from "#/web/components/diff-viewer";
import { Badge } from "#/web/components/ui/badge";

/**
 * Right-rail annotations panel for the review-diff page. Lists every comment
 * the reviewer has anchored on the diff, grouped by file, with quick removal
 * and jump-to-line. The diff viewer owns annotation creation; this panel is a
 * fixed, collapsible summary of what will be submitted as the review.
 */
export function DiffAnnotationsPanel({
  annotations,
  onRemove,
  onJump,
}: {
  annotations: DiffAnnotation[];
  onRemove: (annotation: DiffAnnotation) => void;
  onJump?: (filePath: string) => void;
}) {
  if (annotations.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        No annotations yet. Click a line number in the diff to flag a finding or ask a deferred
        question.
      </div>
    );
  }

  const byFile = new Map<string, DiffAnnotation[]>();
  for (const annotation of annotations) {
    const list = byFile.get(annotation.filePath) ?? [];
    list.push(annotation);
    byFile.set(annotation.filePath, list);
  }

  return (
    <div className="space-y-4 p-3">
      {[...byFile.entries()].map(([filePath, items]) => (
        <section key={filePath} className="space-y-2">
          <button
            type="button"
            onClick={() => onJump?.(filePath)}
            className="block w-full truncate text-left font-mono text-xs text-muted-foreground hover:text-foreground"
            title={filePath}
          >
            {filePath}
          </button>
          <ul className="space-y-2">
            {items.map((annotation, index) => (
              <li
                key={`${filePath}-${annotation.startLine}-${index}`}
                className="rounded-md border border-card-border/60 bg-card p-2 text-xs"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Badge
                    variant={
                      annotation.kind === "deferred-question" ? "severityInfo" : "severityMajor"
                    }
                  >
                    {annotation.kind === "deferred-question" ? "question" : "finding"}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    L{annotation.startLine}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(annotation)}
                    aria-label="Remove annotation"
                    className="ml-auto text-muted-foreground hover:text-destructive"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
                <p className="leading-5 text-secondary-foreground">{annotation.text}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
