import { Schema } from "effect";
import { command } from "#/cli/command";
import { renderContextIndex, renderContextMode } from "#/modules/context/render";

export const contextCommand = command({
  meta: { name: "context", description: "Render live agent context for the current workspace" },
  workspace: { autoCreate: true },
  args: {
    mode: {
      schema: Schema.Literal("prd", "dev", "coder", "auditor"),
      positional: true,
      description: "Context mode (prd/dev/coder/auditor)",
    },
    prdTarget: {
      schema: Schema.String,
      positional: true,
      description: "PRD ID or title to target (dev/coder/auditor mode)",
    },
    review: {
      schema: Schema.String,
      description: "Review ID (coder mode only)",
    },
  },
  run: async ({ args, db, ws, output }) => {
    if (output.isJson()) {
      output.error(
        "unsupported",
        "The context command does not support --json output in this version.",
      );
    }

    if (!args.mode) {
      try {
        output.print(await renderContextIndex(db, ws.id));
      } catch (error) {
        output.error("render_error", error instanceof Error ? error.message : String(error));
      }
      return;
    }

    try {
      output.print(await renderContextMode(db, ws.id, args.mode, args.prdTarget, args.review));
    } catch (error) {
      output.error("render_error", error instanceof Error ? error.message : String(error));
    }
  },
});
