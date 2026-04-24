import { hc } from "hono/client";

import type { AppType } from "#/web/api";

export const rpc = hc<AppType>("/");
