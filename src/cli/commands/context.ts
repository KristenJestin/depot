import { Schema } from "effect";
import { command } from "#/cli/command";
import { getContextTemplate } from "#/modules/context";

export const contextCommand = command({
  meta: { name: "context", description: "Emit static agent context for the current workspace" },
  args: {
    mode: {
      schema: Schema.Literal("prd", "dev", "coder", "auditor", "doc", "ship"),
      positional: true,
      description: "Context mode (prd/dev/coder/auditor/doc/ship)",
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
    axis: {
      schema: Schema.Literal("standards", "spec"),
      description:
        "Auditor axis (auditor mode only). Required: the dev orchestrator spawns one auditor per axis.",
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

    if (mode === "auditor" && !args.axis) {
      return output.error(
        "missing_axis",
        "depot context auditor requires --axis standards|spec. The dev orchestrator spawns one auditor per axis in parallel.",
      );
    }

    const lines: string[] = [];

    const modeLabel = mode ? mode.toUpperCase() : "CONTEXT";
    const axisLabel = args.axis ? ` (${args.axis.toUpperCase()})` : "";
    lines.push(`=== DEPOT CONTEXT — ${modeLabel}${axisLabel} ===`);

    if (args.prdTarget) {
      lines.push(`PRD     : ${args.prdTarget}`);
    }

    if (args.review) {
      lines.push(`Review  : ${args.review}`);
    }

    if (args.axis) {
      lines.push(`Axis    : ${args.axis}`);
    }

    if (args.prdTarget || args.review || args.axis) {
      lines.push("");
    }

    if (mode) {
      lines.push(getContextTemplate(mode));
    }

    output.print(lines.join("\n"));
  },
});
