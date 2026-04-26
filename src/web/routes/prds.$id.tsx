import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";

import { prdsQuery } from "../lib/queries";
import { DotLoader } from "../components/ui/dot-loader";

export const Route = createFileRoute("/prds/$id")({
  loader: async ({ params }) => {
    const data = await prdsQuery.detail.ensureQueryData(params.id);
    if (!data?.prd) throw notFound();
    return data;
  },
  pendingComponent: () => (
    <div className="flex items-center justify-center h-full">
      <DotLoader preset="thinking" label="Loading…" />
    </div>
  ),
  component: () => <Outlet />,
});
