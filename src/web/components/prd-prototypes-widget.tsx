import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ImageIcon } from "lucide-react";

import { Card } from "#/web/components/ui/card";

/**
 * PRD prototypes link section (PRD 0025).
 *
 * One vertical row per non-archived prototype, slug-on-the-left /
 * description-on-the-right, with a single-line truncated description so the
 * card stays compact regardless of how chatty individual prototypes are. The
 * widget renders nothing when the PRD has no prototype attached so the detail
 * page stays uncluttered for the vast majority of PRDs.
 *
 * The route param `$id` is the prd revision id (same convention as the rest
 * of the prd detail page) — `data-depot-page` resolution and the API
 * (`/api/prd-revisions/:revId/prototypes`) both key off the revision.
 */

type PrototypeSummary = {
  id: string;
  slug: string;
  description: string | null;
  createdAt: number;
  archivedAt: number | null;
};

type ListResponse = { items: PrototypeSummary[] };

export function PrdPrototypesWidget({ prdRevisionId }: { prdRevisionId: string }) {
  const { data } = useQuery({
    queryKey: ["prd-revisions", prdRevisionId, "prototypes"],
    queryFn: async (): Promise<ListResponse> => {
      const res = await fetch(`/api/prd-revisions/${prdRevisionId}/prototypes`);
      if (!res.ok) throw new Error(`Failed to fetch prototypes (HTTP ${res.status})`);
      return res.json();
    },
  });

  const active = (data?.items ?? []).filter((p) => p.archivedAt === null);
  if (active.length === 0) return null;

  return (
    <Card className="px-4 py-3">
      <header className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <ImageIcon className="size-3.5" aria-hidden />
        {active.length} prototype{active.length > 1 ? "s" : ""}
      </header>
      <ul className="divide-y divide-card-border">
        {active.map((p) => (
          <li key={p.id} className="py-1.5 first:pt-0 last:pb-0">
            <Link
              to="/prds/$id/prototype/$slug"
              params={{ id: prdRevisionId, slug: p.slug }}
              className="flex items-baseline gap-3 text-sm hover:underline"
            >
              <span className="font-medium text-primary">{p.slug}</span>
              {p.description ? (
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {p.description}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
