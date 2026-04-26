import type { InferResponseType } from "hono/client";

import { rpc } from "./client";

export type PrdListResponse = InferResponseType<typeof rpc.api.prds.$get, 200>;
export type PrdDetailResponse = InferResponseType<(typeof rpc.api.prds)[":id"]["$get"], 200>;
export type Task = PrdDetailResponse["tasks"][number];
export type FindingTask = NonNullable<PrdDetailResponse["review"]>["findings"][number];
export type ReviewDetailResponse = InferResponseType<
  (typeof rpc.api.prds)[":id"]["reviews"][":reviewId"]["$get"],
  200
>;
export type ReviewFinding = ReviewDetailResponse["findings"][number];
export type TaskDetailResponse = InferResponseType<
  (typeof rpc.api.prds)[":id"]["tasks"][":taskId"]["$get"],
  200
>;
