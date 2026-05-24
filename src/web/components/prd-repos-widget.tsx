import * as React from "react";
import { XIcon } from "lucide-react";

import { Badge } from "#/web/components/ui/badge";
import { Button } from "#/web/components/ui/button";
import { Card } from "#/web/components/ui/card";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";

export type PrdRepoSummary = {
  id: string;
  name: string;
  path: string;
  isPrimary: boolean;
  baseBranch: string;
};

/**
 * Read-write widget that exposes the PRD's `prd_repo` scope.
 *
 * Stateless: the parent owns the data (typically React Query) and passes
 * `onAdd` / `onRemove` callbacks that mutate via the matching API endpoints.
 * The widget enforces the two domain-level UX rules :
 *
 * - In a mono-repo project (no `project_repo` registered), the section renders
 *   as "not applicable" — no add control, no list.
 * - The add selector only proposes `project_repo` rows that are not already in
 *   the scope, so the user can't fire a no-op POST.
 */
export function PrdReposWidget({
  items,
  projectRepos,
  implicit,
  onAdd,
  onRemove,
  error,
  pending,
}: {
  items: PrdRepoSummary[];
  projectRepos: PrdRepoSummary[];
  implicit: boolean;
  onAdd: (repoName: string) => void;
  onRemove: (repoName: string) => void;
  error?: string | null;
  pending?: boolean;
}) {
  const declaredIds = new Set(items.map((r) => r.id));
  const candidates = projectRepos.filter((r) => !declaredIds.has(r.id));
  const [selected, setSelected] = React.useState<string>("");

  React.useEffect(() => {
    if (selected && !candidates.find((c) => c.name === selected)) {
      setSelected("");
    }
  }, [selected, candidates]);

  return (
    <section className="space-y-2" aria-label="PRD repos">
      <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Repos</h2>
      <Card className="border border-card-border p-4">
        {implicit ? (
          <p className="text-xs text-muted-foreground">
            Not applicable — this project has no registered <code>project_repo</code>. Repo scope is
            implicit (single repo derived from the workspace).
          </p>
        ) : (
          <div className="space-y-3">
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No repos declared yet — defaults to every <code>project_repo</code> of the project.
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map((repo) => (
                  <li
                    key={repo.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-card-border bg-card px-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="font-medium text-foreground">{repo.name}</span>
                      {repo.isPrimary ? (
                        <Badge variant="outline" className="text-[10px]">
                          primary
                        </Badge>
                      ) : null}
                      <code
                        className="ml-auto truncate text-[11px] text-muted-foreground"
                        title={repo.path}
                      >
                        {repo.path}
                      </code>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemove(repo.name)}
                      aria-label={`Remove ${repo.name}`}
                      disabled={pending}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {candidates.length > 0 ? (
              <div className="flex items-center gap-2">
                <label htmlFor="prd-repo-add" className="sr-only">
                  Repo to add
                </label>
                <Select value={selected} onValueChange={(value) => setSelected(value ?? "")}>
                  <SelectTrigger
                    id="prd-repo-add"
                    aria-label="Repo to add"
                    size="sm"
                    className="flex-1"
                  >
                    <SelectValue placeholder="Choose a project_repo..." />
                  </SelectTrigger>
                  <SelectPopup>
                    {candidates.map((repo) => (
                      <SelectItem key={repo.id} value={repo.name}>
                        {repo.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Button
                  size="sm"
                  onClick={() => {
                    if (selected) {
                      onAdd(selected);
                      setSelected("");
                    }
                  }}
                  disabled={!selected || pending}
                >
                  Add
                </Button>
              </div>
            ) : items.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                All <code>project_repo</code> rows of this project are already in the scope.
              </p>
            ) : null}

            {error ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </section>
  );
}
