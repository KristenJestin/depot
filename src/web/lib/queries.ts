import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import type {
  PrdListResponse,
  PrdDetailResponse,
  ReviewDetailResponse,
  TaskDetailResponse,
  ContextResponse,
  WorkspacesResponse,
  ProjectsResponse,
} from "./api-types";
import { rpc } from "./client";
import { queryClient } from "./query-client";

const LIVE_PAGE_REFETCH_INTERVAL = 4_000;

const liveQueryOptions = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: "always" as const,
  refetchInterval: LIVE_PAGE_REFETCH_INTERVAL,
  refetchIntervalInBackground: true,
};

export type PrdsListFilters = {
  tag?: string;
  milestone?: string;
  dependsOn?: string;
};

const buildPrdsListUrl = (filters?: PrdsListFilters): string => {
  const params = new URLSearchParams();
  if (filters?.tag) params.set("tag", filters.tag);
  if (filters?.milestone) params.set("milestone", filters.milestone);
  if (filters?.dependsOn) params.set("dependsOn", filters.dependsOn);
  const qs = params.toString();
  return qs ? `/api/prds?${qs}` : `/api/prds`;
};

export const prdsQuery = {
  list: {
    options: (filters?: PrdsListFilters) =>
      queryOptions({
        queryKey: ["prds", filters ?? {}],
        queryFn: async (): Promise<PrdListResponse> => {
          // Hono's typed client doesn't yet model dynamic query strings here,
          // so we hit fetch directly for the filtered case. Shape is the same.
          const r = await fetch(buildPrdsListUrl(filters));
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<PrdListResponse>;
        },
        ...liveQueryOptions,
      }),
    useSuspense: (filters?: PrdsListFilters) => useSuspenseQuery(prdsQuery.list.options(filters)),
    ensureQueryData: (filters?: PrdsListFilters) =>
      queryClient.ensureQueryData(prdsQuery.list.options(filters)),
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
        refetchInterval: (query) => {
          const status = (query.state.data as PrdDetailResponse | undefined)?.prd.status;
          return status === "in_progress" ? LIVE_PAGE_REFETCH_INTERVAL : false;
        },
      }),
    useSuspense: (id: string) => useSuspenseQuery(prdsQuery.detail.options(id)),
    ensureQueryData: (id: string) => queryClient.ensureQueryData(prdsQuery.detail.options(id)),
  },
};

export type MilestoneResponse = {
  items: Array<{
    id: string;
    prdId: string;
    title: string;
    status: import("./api-types").PrdListResponse["prds"][number]["status"];
    createdAt: string;
    updatedAt: string;
  }>;
  summary: {
    version: string;
    total: number;
    byStatus: Record<"draft" | "ready" | "in_progress" | "review" | "done" | "canceled", number>;
  };
};

export const milestonesQuery = {
  detail: {
    options: (version: string) =>
      queryOptions({
        queryKey: ["milestones", version],
        queryFn: async (): Promise<MilestoneResponse> => {
          const r = await fetch(`/api/milestones/${encodeURIComponent(version)}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<MilestoneResponse>;
        },
        ...liveQueryOptions,
      }),
    useSuspense: (version: string) => useSuspenseQuery(milestonesQuery.detail.options(version)),
    ensureQueryData: (version: string) =>
      queryClient.ensureQueryData(milestonesQuery.detail.options(version)),
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

export const projectsQuery = {
  options: () =>
    queryOptions({
      queryKey: ["projects"],
      queryFn: async (): Promise<ProjectsResponse> => {
        const r = await rpc.api.projects.$get();
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ProjectsResponse>;
      },
      staleTime: 60_000,
    }),
  useSuspense: () => useSuspenseQuery(projectsQuery.options()),
  ensureQueryData: () => queryClient.ensureQueryData(projectsQuery.options()),
};

export async function switchWorkspace(workspaceId: string | null): Promise<void> {
  await rpc.api.context.$patch({ json: { workspaceId } });
  await queryClient.invalidateQueries();
}
