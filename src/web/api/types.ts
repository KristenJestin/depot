import type { Database } from "#/db/client";

export type Variables = {
  db: Database;
  currentWorkspaceId: string | null;
};
