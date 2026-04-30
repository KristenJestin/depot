import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import type {
  PrdListResponse,
  PrdDetailResponse,
  ReviewDetailResponse,
  TaskDetailResponse,
  ContextResponse,
  WorkspacesResponse,
} from "./api-types";
import { rpc } from "./client";
import { queryClient } from "./query-client";

const LIVE_PAGE_REFETCH_INTERVAL = 5_000;

const liveQueryOptions = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: "always" as const,
  refetchInterval: LIVE_PAGE_REFETCH_INTERVAL,
  refetchIntervalInBackground: true,
};

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
        ...liveQueryOptions,
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
        ...liveQueryOptions,
      }),
    useSuspense: (id: string) => useSuspenseQuery(prdsQuery.detail.options(id)),
    ensureQueryData: (id: string) => queryClient.ensureQueryData(prdsQuery.detail.options(id)),
  },
};

export const reviewsQuery = {
  detail: {
    options: (prdId: string, reviewId: string) =>
      queryOptions({
        queryKey: ["prds", prdId, "reviews", reviewId],
        queryFn: async (): Promise<ReviewDetailResponse> => {
          const r = await rpc.api.prds[":id"].reviews[":reviewId"].$get({
            param: { id: prdId, reviewId },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<ReviewDetailResponse>;
        },
        ...liveQueryOptions,
      }),
    useSuspense: (prdId: string, reviewId: string) =>
      useSuspenseQuery(reviewsQuery.detail.options(prdId, reviewId)),
    ensureQueryData: (prdId: string, reviewId: string) =>
      queryClient.ensureQueryData(reviewsQuery.detail.options(prdId, reviewId)),
  },
};

export const tasksQuery = {
  detail: {
    options: (prdId: string, taskId: string) =>
      queryOptions({
        queryKey: ["prds", prdId, "tasks", taskId],
        queryFn: async (): Promise<TaskDetailResponse> => {
          const r = await rpc.api.prds[":id"].tasks[":taskId"].$get({
            param: { id: prdId, taskId },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<TaskDetailResponse>;
        },
        ...liveQueryOptions,
      }),
    useSuspense: (prdId: string, taskId: string) =>
      useSuspenseQuery(tasksQuery.detail.options(prdId, taskId)),
    ensureQueryData: (prdId: string, taskId: string) =>
      queryClient.ensureQueryData(tasksQuery.detail.options(prdId, taskId)),
  },
};

export const contextQuery = {
  options: () =>
    queryOptions({
      queryKey: ["context"],
      queryFn: async (): Promise<ContextResponse> => {
        const r = await rpc.api.context.$get();
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ContextResponse>;
      },
      ...liveQueryOptions,
    }),
  useSuspense: () => useSuspenseQuery(contextQuery.options()),
  ensureQueryData: () => queryClient.ensureQueryData(contextQuery.options()),
};

export const workspacesQuery = {
  options: () =>
    queryOptions({
      queryKey: ["workspaces"],
      queryFn: async (): Promise<WorkspacesResponse> => {
        const r = await rpc.api.workspaces.$get();
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<WorkspacesResponse>;
      },
      staleTime: 60_000,
    }),
  useSuspense: () => useSuspenseQuery(workspacesQuery.options()),
  ensureQueryData: () => queryClient.ensureQueryData(workspacesQuery.options()),
};

export async function switchWorkspace(workspaceId: string | null): Promise<void> {
  await rpc.api.context.$patch({ json: { workspaceId } });
  await queryClient.invalidateQueries();
}
