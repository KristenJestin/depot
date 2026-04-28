import type { InferResponseType } from "hono/client";

import { rpc } from "./client";

export type PrdListResponse = InferResponseType<typeof rpc.api.prds.$get, 200>;
export type PrdDetailResponse = InferResponseType<(typeof rpc.api.prds)[":id"]["$get"], 200>;
export type Task = PrdDetailResponse["tasks"][number];
export type PrdReview = PrdDetailResponse["reviews"][number];
export type FindingTask = PrdReview["findings"][number];
export type ReviewDetailResponse = InferResponseType<
  (typeof rpc.api.prds)[":id"]["reviews"][":reviewId"]["$get"],
  200
>;
export type ReviewFinding = ReviewDetailResponse["findings"][number];
export type TaskDetailResponse = InferResponseType<
  (typeof rpc.api.prds)[":id"]["tasks"][":taskId"]["$get"],
  200
>;
export type ContextResponse = InferResponseType<typeof rpc.api.context.$get, 200>;
export type WorkspacesResponse = InferResponseType<typeof rpc.api.workspaces.$get, 200>;
export type Workspace = WorkspacesResponse["workspaces"][number];
