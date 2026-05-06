import { Markdown } from "#/web/components/markdown";
import { getTaskDescriptionSections } from "#/modules/tasks/spec";

interface TaskLike {
  description: string;
  doneCriteria: string;
}

export function TaskDetail({ task }: { task: TaskLike }) {
  const sections = getTaskDescriptionSections(task.description);

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
      <h4 className="font-semibold text-sm">Execution plan</h4>

      <div className="space-y-3">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="text-xs font-semibold text-foreground mb-1">{section.label}</p>
            <Markdown
              source={section.lines.join("\n")}
              className="text-xs text-muted-foreground leading-normal"
            />
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-border">
        <p className="text-xs font-semibold text-foreground mb-1">Done when</p>
        <div className="bg-secondary/50 rounded-lg px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Markdown source={task.doneCriteria} />
        </div>
      </div>
    </div>
  );
}
