import { FilterIcon, XIcon } from "lucide-react";
import * as React from "react";

import { Badge } from "#/web/components/ui/badge";
import { Button } from "#/web/components/ui/button";
import { Input } from "#/web/components/ui/input";

/**
 * Inline filter bar above the PRD board (PRD 0019 / T4). All three filters
 * are free-form text inputs — `tag`, `milestone`, `dependsOn`. The bar is
 * stateless: the parent owns the URL search params and passes the current
 * values + a single `onChange` callback.
 */
export type PrdFilterValues = {
  tag: string;
  milestone: string;
  dependsOn: string;
};

export function PrdFiltersBar({
  values,
  onChange,
  resultCount,
}: {
  values: PrdFilterValues;
  onChange: (next: PrdFilterValues) => void;
  resultCount?: number;
}) {
  const [draft, setDraft] = React.useState(values);
  React.useEffect(() => setDraft(values), [values.tag, values.milestone, values.dependsOn]);

  const hasFilter = Boolean(values.tag || values.milestone || values.dependsOn);

  const submit = (next: PrdFilterValues) => {
    setDraft(next);
    onChange(next);
  };

  return (
    <form
      data-testid="prd-filters-bar"
      className="flex flex-wrap items-center gap-2 border-b border-card-border bg-panel-muted px-3 py-2 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        submit(draft);
      }}
    >
      <FilterIcon className="size-3.5 text-muted-foreground" aria-hidden />
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Tag</span>
        <Input
          aria-label="Filter by tag"
          value={draft.tag}
          onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
          className="h-7 w-32 text-xs"
          placeholder="kebab-case"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Milestone</span>
        <Input
          aria-label="Filter by milestone"
          value={draft.milestone}
          onChange={(event) => setDraft({ ...draft, milestone: event.target.value })}
          className="h-7 w-32 text-xs"
          placeholder="e.g. 2.6.1"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Depends on</span>
        <Input
          aria-label="Filter by dependency PRD id"
          value={draft.dependsOn}
          onChange={(event) => setDraft({ ...draft, dependsOn: event.target.value })}
          className="h-7 w-44 text-xs"
          placeholder="PRD id"
        />
      </label>
      <Button type="submit" size="sm" variant="primary">
        Apply
      </Button>
      {hasFilter ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Clear filters"
          onClick={() => submit({ tag: "", milestone: "", dependsOn: "" })}
        >
          <XIcon className="size-3" />
          Clear
        </Button>
      ) : null}
      {resultCount !== undefined ? (
        <Badge variant="subtle" className="ml-auto text-[10px]">
          {resultCount} {resultCount === 1 ? "PRD" : "PRDs"}
        </Badge>
      ) : null}
    </form>
  );
}
