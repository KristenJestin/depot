import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";

import { DotLoader } from "../components/ui/dot-loader";
import { prdsQuery } from "../lib/queries";

export const Route = createFileRoute("/prds/$id")({
  loader: async ({ params }) => {
    const data = await prdsQuery.detail.ensureQueryData(params.id);
    if (!data?.prd) throw notFound();
    return data;
  },
  pendingComponent: () => (
    <div className="flex h-full items-center justify-center bg-card">
      <DotLoader preset="thinking" label="Loading..." />
    </div>
  ),
  component: () => <Outlet />,
});
