import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import * as React from "react";

export type DiffTreeFile = {
  /** Real file path — drives the folder tree layout. */
  path: string;
  status: string;
  /**
   * Selection key emitted by `onSelect` / matched by `selectedPath`. Defaults
   * to `path`. Multi-repo callers pass a `repoName:path` key so two repos that
   * change a same-named file stay distinct without polluting the displayed
   * filename.
   */
  key?: string;
};

export type DiffTreeRepoGroup = {
  repoName: string;
  files: DiffTreeFile[];
};

/** Maps a one-letter git status (`A`/`M`/`D`/`R`) to `@pierre/trees`' status. */
function gitStatusFor(status: string): GitStatusEntry["status"] {
  switch (status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

type TreeInput = {
  /** Tree paths fed to `@pierre/trees`. Multi-repo paths are prefixed with the
   * repo name so each repo renders as a top-level folder. */
  paths: string[];
  /** Maps a tree path back to the caller's selection key. */
  pathToKey: Map<string, string>;
  /** Maps the caller's selection key to its tree path (for `selectedPath`). */
  keyToPath: Map<string, string>;
  gitStatus: GitStatusEntry[];
};

function buildTreeInput(groups: DiffTreeRepoGroup[]): TreeInput {
  const nonEmpty = groups.filter((g) => g.files.length > 0);
  const multiRepo = nonEmpty.length > 1;
  const paths: string[] = [];
  const pathToKey = new Map<string, string>();
  const keyToPath = new Map<string, string>();
  const gitStatus: GitStatusEntry[] = [];
  for (const group of nonEmpty) {
    for (const file of group.files) {
      const key = file.key ?? file.path;
      const treePath = multiRepo ? `${group.repoName}/${file.path}` : file.path;
      paths.push(treePath);
      pathToKey.set(treePath, key);
      keyToPath.set(key, treePath);
      gitStatus.push({ path: treePath, status: gitStatusFor(file.status) });
    }
  }
  return { paths, pathToKey, keyToPath, gitStatus };
}

export interface DiffTreeProps {
  files: DiffTreeFile[];
  selectedPath?: string | null;
  onSelect?: (path: string) => void;
}

/**
 * Flat (single-repo) file tree of a diff, rendered with `@pierre/trees`.
 */
export function DiffTree({ files, selectedPath, onSelect }: DiffTreeProps) {
  return (
    <DiffTreeGrouped
      groups={[{ repoName: "(default)", files }]}
      selectedPath={selectedPath}
      onSelect={onSelect}
    />
  );
}

/**
 * Multi-repo file tree of a diff, rendered with `@pierre/trees`. When the diff
 * spans several repos, each repo becomes a top-level folder so a PRD's changed
 * files stay grouped by repo. Selecting a file emits the caller's selection
 * key (`repoName:path` for multi-repo callers).
 */
export function DiffTreeGrouped({
  groups,
  selectedPath,
  onSelect,
}: {
  groups: DiffTreeRepoGroup[];
  selectedPath?: string | null;
  onSelect?: (path: string) => void;
}) {
  const input = React.useMemo(() => buildTreeInput(groups), [groups]);
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;
  const pathToKeyRef = React.useRef(input.pathToKey);
  pathToKeyRef.current = input.pathToKey;

  const { model } = useFileTree({
    paths: input.paths,
    gitStatus: input.gitStatus,
    initialExpansion: "open",
    onSelectionChange: (selected) => {
      const treePath = selected[0];
      if (treePath === undefined) return;
      const key = pathToKeyRef.current.get(treePath);
      if (key) onSelectRef.current?.(key);
    },
  });

  // Keep the model's path set and git status in sync when the diff changes.
  React.useEffect(() => {
    model.resetPaths(input.paths);
    model.setGitStatus(input.gitStatus);
  }, [model, input.paths, input.gitStatus]);

  // Mirror the externally-controlled selection into the tree model.
  React.useEffect(() => {
    if (!selectedPath) return;
    const treePath = input.keyToPath.get(selectedPath);
    if (!treePath) return;
    const item = model.getItem(treePath);
    if (item && !item.isSelected()) {
      item.select();
      model.scrollToPath(treePath, { offset: "nearest" });
    }
  }, [model, selectedPath, input.keyToPath]);

  if (input.paths.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No files changed.</div>;
  }

  return <FileTree model={model} className="size-full text-xs" />;
}
