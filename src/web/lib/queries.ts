import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import type { PrdListResponse, PrdDetailResponse } from "./api-types";
import { rpc } from "./client";
import { queryClient } from "./query-client";

export const prdsQuery = {
  list: {
    options: () =>
      queryOptions({
        queryKey: ["prds"],
        queryFn: async (): Promise<PrdListResponse> => {
          const r = await rpc.api.prds.$get();
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<PrdListResponse>;
        },
      }),
    useSuspense: () => useSuspenseQuery(prdsQuery.list.options()),
    ensureQueryData: () => queryClient.ensureQueryData(prdsQuery.list.options()),
  },
  detail: {
    options: (id: string) =>
      queryOptions({
        queryKey: ["prds", id],
        queryFn: async (): Promise<PrdDetailResponse> => {
          const r = await rpc.api.prds[":id"].$get({ param: { id } });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<PrdDetailResponse>;
        },
      }),
    useSuspense: (id: string) => useSuspenseQuery(prdsQuery.detail.options(id)),
    ensureQueryData: (id: string) => queryClient.ensureQueryData(prdsQuery.detail.options(id)),
  },
};
