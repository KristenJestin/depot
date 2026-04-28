import { Schema } from "effect";
import { command } from "#/cli/command";
import { getContextTemplate } from "#/modules/context";

export const contextCommand = command({
  meta: { name: "context", description: "Emit static agent context for the current workspace" },
  args: {
    mode: {
      schema: Schema.Literal("prd", "dev", "coder", "auditor"),
      positional: true,
      description: "Context mode (prd/dev/coder/auditor)",
    },
    prdTarget: {
      schema: Schema.String,
      positional: true,
      default: "",
      description: "PRD ID or title to embed in the header (dev/coder/auditor mode)",
    },
    review: {
      schema: Schema.String,
      description: "Review ID to embed in the header (coder mode only)",
    },
  },
  run: async ({ args, output }) => {
    if (output.isJson()) {
      output.error(
        "unsupported",
        "The context command does not support --json output in this version.",
      );
    }

    const mode = args.mode;
    const lines: string[] = [];

    const modeLabel = mode ? mode.toUpperCase() : "CONTEXT";
    lines.push(`=== DEPOT CONTEXT — ${modeLabel} ===`);

    if (args.prdTarget) {
      lines.push(`PRD     : ${args.prdTarget}`);
    }

    if (args.review) {
      lines.push(`Review  : ${args.review}`);
    }

    if (args.prdTarget || args.review) {
      lines.push("");
    }

    if (mode) {
      lines.push(getContextTemplate(mode));
    }

    output.print(lines.join("\n"));
  },
});
