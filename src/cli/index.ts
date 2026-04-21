import { runMain } from "citty";
import { initCommand, projectCommand } from "#/cli/commands/project";
import { prdCommand } from "#/cli/commands/prd";
import { taskCommand } from "#/cli/commands/task";
import { logCommand } from "#/cli/commands/log";
import { handoffCommand } from "#/cli/commands/handoff";
import { contextCommand } from "#/cli/commands/context";
import { installCommand } from "#/cli/commands/install";
import { reviewCommand } from "#/cli/commands/review";
import { workspaceCommand } from "#/cli/commands/workspace";
import { defineValidatedCommand } from "#/cli/command";
import { setDebug, setJsonMode } from "#/lib/logger";
import * as z from "zod";
import pkg from "../../package.json";

const mainArgsSchema = z.object({
  debug: z.boolean().default(false),
  json: z.boolean().default(false),
});

const main = defineValidatedCommand({
  schema: mainArgsSchema,
  meta: {
    name: "depot",
    version: pkg.version,
    description: "AI agent task and PRD management CLI",
  },
  args: {
    debug: {
      type: "boolean",
      description: "Enable verbose debug output",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON output on stdout",
      default: false,
    },
  },
  setup({ args }) {
    if (args.debug) {
      setDebug(true);
    }
    if (args.json) {
      setJsonMode(true);
    }
  },
  subCommands: {
    init: initCommand,
    project: projectCommand,
    workspace: workspaceCommand,
    prd: prdCommand,
    task: taskCommand,
    log: logCommand,
    handoff: handoffCommand,
    context: contextCommand,
    install: installCommand,
    review: reviewCommand,
  },
});

runMain(main);
