import type { Task } from "../lib/api-types";
import { parseDesc } from "../lib/format";

function DescField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-2xs tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div className="text-xs text-foreground leading-normal opacity-75">{value}</div>
    </div>
  );
}

export function TaskDetail({ task }: { task: Task }) {
  const desc = parseDesc(task.description);
  return (
    <div className="mx-2 mb-1 bg-card border-l-2 border-primary/30 rounded-r-sm px-3 py-2">
      {desc ? (
        <div className="grid grid-cols-3 gap-2 mb-2">
          {desc.intent && <DescField label="INTENT" value={desc.intent} />}
          {desc.scope && <DescField label="SCOPE" value={desc.scope} />}
          {desc.nongoals && <DescField label="NON-GOALS" value={desc.nongoals} />}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground leading-normal mb-2">{task.description}</p>
      )}
      <div className="font-mono text-2xs tracking-wider text-muted-foreground mb-1">DONE WHEN</div>
      <div className="bg-secondary rounded px-2 py-1.5 text-xs leading-normal opacity-80">
        {task.doneCriteria}
      </div>
    </div>
  );
}
