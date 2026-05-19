import { ChevronDownIcon, ChevronRightIcon, FileIcon } from "lucide-react";
import * as React from "react";

import { cn } from "#/web/lib/utils";

export type DiffTreeFile = {
  path: string;
  status: string;
};

type Node =
  | { kind: "folder"; name: string; path: string; children: Node[] }
  | { kind: "file"; name: string; path: string; status: string };
type FolderNode = Extract<Node, { kind: "folder" }>;

function buildTree(files: DiffTreeFile[]): FolderNode {
  const root: FolderNode = { kind: "folder", name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cursor: FolderNode = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLeaf = i === parts.length - 1;
      const subPath = parts.slice(0, i + 1).join("/");
      if (isLeaf) {
        cursor.children.push({ kind: "file", name: part, path: f.path, status: f.status });
      } else {
        let next: FolderNode | undefined = cursor.children.find(
          (c): c is FolderNode => c.kind === "folder" && c.name === part,
        );
        if (!next) {
          next = { kind: "folder", name: part, path: subPath, children: [] };
          cursor.children.push(next);
        }
        cursor = next;
      }
    }
  }
  const sortRecursive = (node: Node) => {
    if (node.kind !== "folder") return;
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) sortRecursive(c);
  };
  sortRecursive(root);
  return root;
}

const STATUS_COLORS: Record<string, string> = {
  A: "text-emerald-400",
  M: "text-amber-400",
  D: "text-rose-400",
  R: "text-blue-400",
};

export interface DiffTreeProps {
  files: DiffTreeFile[];
  selectedPath?: string | null;
  onSelect?: (path: string) => void;
}

export function DiffTree({ files, selectedPath, onSelect }: DiffTreeProps) {
  const tree = React.useMemo(() => buildTree(files), [files]);
  if (files.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No files changed.</div>;
  }
  return (
    <div className="overflow-auto py-1 text-xs">
      {tree.children.map((node) => (
        <NodeView
          key={node.kind === "folder" ? `dir-${node.path}` : `file-${node.path}`}
          node={node}
          depth={0}
          selectedPath={selectedPath ?? null}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function NodeView({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: Node;
  depth: number;
  selectedPath: string | null;
  onSelect?: (path: string) => void;
}) {
  const [open, setOpen] = React.useState(true);

  if (node.kind === "file") {
    const isSelected = selectedPath === node.path;
    return (
      <button
        type="button"
        onClick={() => onSelect?.(node.path)}
        className={cn(
          "flex w-full items-center gap-1.5 px-2 py-0.5 text-left transition-colors hover:bg-accent/40",
          isSelected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        <FileIcon className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
        <span
          className={cn(
            "ml-auto shrink-0 font-mono text-[10px]",
            STATUS_COLORS[node.status] ?? "text-muted-foreground",
          )}
        >
          {node.status}
        </span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 py-0.5 text-left text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <div>
          {node.children.map((child) => (
            <NodeView
              key={child.kind === "folder" ? `dir-${child.path}` : `file-${child.path}`}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
