import { defineValidatedCommand } from "#/cli/command";
import { getDb } from "#/cli/runtime";
import { outputSuccess, outputError, isJsonMode } from "#/cli/output";
import { resolveWorkspace } from "#/lib/workflow";
import { buildHandoff, buildHandoffData } from "#/lib/handoff";
import * as z from "zod";

export const handoffCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: {
    name: "handoff",
    description: "Generate a structured handoff summary for the current workspace",
  },
  run: async () => {
    const db = await getDb();
    const cwd = process.cwd().replace(/\\/g, "/");
    const ws = await resolveWorkspace(db, cwd);
    if (!ws) {
      outputError("no_workspace", "No workspace found for current directory. Run `depot init` first.");
    }
    if (isJsonMode()) {
      const data = await buildHandoffData(db, ws.id);
      outputSuccess({ item: data });
    } else {
      const output = await buildHandoff(db, ws.id);
      console.log(output);
    }
  },
});
