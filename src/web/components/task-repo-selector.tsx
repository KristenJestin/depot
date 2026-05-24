import type { PrdRepoSummary } from "#/web/components/prd-repos-widget";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";

/**
 * Read-write `repo` selector for a task.
 *
 * The dropdown is sourced strictly from `prdRepos` (i.e. the PRD's `prd_repo`
 * rows). The "no repo" entry is always present and explicitly labelled —
 * `null` is a legitimate task.repoId value (mono-repo, or a project-wide change
 * that doesn't belong to any registered repo, e.g. `CLAUDE.md` at the shell
 * root of a multi-repo project).
 */
export function TaskRepoSelector({
  currentRepoId,
  prdRepos,
  onChange,
  error,
  disabled,
}: {
  currentRepoId: string | null;
  prdRepos: PrdRepoSummary[];
  onChange: (repoId: string | null) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground" htmlFor="task-repo-select">
        Repo
      </label>
      <Select
        value={currentRepoId ?? "__none"}
        onValueChange={(value) => {
          onChange(value === "__none" ? null : (value ?? null));
        }}
        disabled={disabled}
      >
        <SelectTrigger id="task-repo-select" aria-label="Repo" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="__none">(no repo)</SelectItem>
          {prdRepos.map((repo) => (
            <SelectItem key={repo.id} value={repo.id}>
              {repo.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {prdRepos.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No repo declared on this PRD — declare one in the &laquo;&nbsp;Repos&nbsp;&raquo; section
          to attach the task to a repo.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
