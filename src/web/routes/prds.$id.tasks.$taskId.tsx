import * as React from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { tasksQuery } from "../lib/queries";

export const Route = createFileRoute("/prds/$id/tasks/$taskId")({
  loader: async ({ params }) => {
    try {
      await tasksQuery.detail.ensureQueryData(params.id, params.taskId);
    } catch {
      throw notFound();
    }
  },
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { id, taskId } = Route.useParams();
  const navigate = Route.useNavigate();

  React.useEffect(() => {
    void navigate({
      to: "/prds/$id",
      params: { id },
      search: { taskId },
      replace: true,
    });
  }, [id, navigate, taskId]);

  return (
    <div className="flex h-full items-center justify-center px-6">
      <p className="text-sm text-muted-foreground">Opening task...</p>
    </div>
  );
}
