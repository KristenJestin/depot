import { LightbulbIcon } from "lucide-react";

import { Markdown } from "#/web/components/markdown";
import { Badge } from "#/web/components/ui/badge";
import { Card } from "#/web/components/ui/card";
import type { PrdDetailResponse } from "#/web/lib/api-types";

/**
 * PRD source-ideas section (PRD 0027 / T7).
 *
 * Read-only block listing the uncommitted ideas that motivated this PRD —
 * the `prd_ideas` reference join surfaced on the detail payload. Mirrors the
 * annexes / prototypes blocks in style. Renders nothing when there are none,
 * so a PRD with no linked source ideas shows no empty section.
 *
 * Ideas are short by construction, so the full title + body render inline
 * (verbatim), matching how `depot context prd` renders source ideas.
 */

type SourceIdea = PrdDetailResponse["sourceIdeas"][number];

export function PrdSourceIdeasSection({ sourceIdeas }: { sourceIdeas: SourceIdea[] }) {
  if (sourceIdeas.length === 0) return null;

  return (
    <section className="space-y-3" data-testid="prd-source-ideas-section">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <LightbulbIcon className="size-3.5" />
        Source ideas
      </h2>
      <ul className="space-y-4" aria-label="PRD source ideas">
        {sourceIdeas.map((idea) => (
          <li key={idea.id}>
            <Card
              className="gap-3 border border-card-border p-4"
              data-testid="prd-source-idea-card"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 font-medium text-foreground">{idea.title}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {idea.tag ? (
                    <Badge variant="outline" className="text-[10px]">
                      {idea.tag}
                    </Badge>
                  ) : null}
                  <Badge variant="subtle" className="text-[10px]">
                    {idea.status}
                  </Badge>
                </div>
              </div>
              {idea.body && idea.body.trim() !== "" ? (
                <div className="rounded-md border border-card-border bg-muted/20 p-3">
                  <Markdown
                    source={idea.body}
                    className="text-xs leading-5 text-secondary-foreground"
                  />
                </div>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
