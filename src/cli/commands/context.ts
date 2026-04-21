import { defineValidatedCommand } from "#/cli/command";
import { resolveCurrentWorkspace } from "#/cli/runtime";
import { renderContextIndex, renderContextMode, type ContextMode } from "#/lib/agent-context";
import * as z from "zod";

const contextArgsSchema = z.object({
  mode: z.enum(["prd", "dev", "review"]).optional(),
  prdTarget: z.string().optional(),
});

export const contextCommand = defineValidatedCommand({
  schema: contextArgsSchema,
  meta: { name: "context", description: "Render live agent context for the current workspace" },
  args: {
    mode: {
      type: "positional",
      description: "Context mode (prd/dev/review)",
      required: false,
    },
    prdTarget: {
      type: "positional",
      description: "PRD ID or title to target (dev mode only)",
      required: false,
    },
  },
  run: async ({ args }) => {
    const { db, ws } = await resolveCurrentWorkspace({ autoCreate: true });

    if (!args.mode) {
      console.log(await renderContextIndex(db, ws.id));
      return;
    }

    try {
      console.log(
        await renderContextMode(db, ws.id, args.mode as ContextMode, args.prdTarget),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
