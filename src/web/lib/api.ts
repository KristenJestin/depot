import type { InferResponseType } from "hono/client";

import { rpc } from "#/web/lib/client";

export const api = {
  prds: {
    list: (): Promise<InferResponseType<typeof rpc.api.prds.$get, 200>> =>
      rpc.api.prds.$get().then((r) => r.json()),
  },
} as const;
