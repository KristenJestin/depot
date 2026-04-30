import { ChevronRightIcon, FileIcon } from "lucide-react";

import { cn } from "#/web/lib/utils";

export type FileChange = {
  path: string;
  added: number;
  removed: number;
};

function fileIconColor(path: string): string {
  const ext = path.split(".").pop() ?? "";
  if (["ts", "tsx"].includes(ext)) return "text-primary";
  if (["js", "jsx"].includes(ext)) return "text-warning";
  if (["json", "yaml", "yml"].includes(ext)) return "text-success";
  return "text-muted-foreground";
}

function FileChangeRow({ file }: { file: FileChange }) {
  return (
    <div className="p-3 hover:bg-muted/20 flex items-center justify-between group cursor-default transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <FileIcon className={cn("size-4 shrink-0", fileIconColor(file.path))} />
        <span className="font-mono text-sm group-hover:text-primary transition-colors truncate">
          {file.path}
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs font-mono shrink-0 ml-4">
        <div className="flex gap-2">
          <span className="text-success">+{file.added}</span>
          <span className="text-destructive">-{file.removed}</span>
        </div>
        <ChevronRightIcon className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

export function FileChangeList({
  files,
  title = "Modified files",
}: {
  files: FileChange[];
  title?: string;
}) {
  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalRemoved = files.reduce((s, f) => s + f.removed, 0);

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-secondary/30 flex justify-between items-center">
        <h3 className="font-semibold text-sm">{title}</h3>
        {files.length > 0 && (
          <span className="text-xs text-muted-foreground font-mono">
            {files.length} file{files.length !== 1 ? "s" : ""} changed (+{totalAdded}, -
            {totalRemoved})
          </span>
        )}
      </div>
      {files.length === 0 ? (
        <div className="px-5 py-4 text-xs text-muted-foreground">No file changes yet.</div>
      ) : (
        <div className="divide-y divide-border">
          {files.map((f) => (
            <FileChangeRow key={f.path} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}
