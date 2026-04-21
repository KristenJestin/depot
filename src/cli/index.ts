import { runMain } from "citty";
import { initCommand, projectCommand } from "#/cli/commands/project";
import { prdCommand } from "#/cli/commands/prd";
import { taskCommand } from "#/cli/commands/task";
import { logCommand } from "#/cli/commands/log";
import { handoffCommand } from "#/cli/commands/handoff";
import { contextCommand } from "#/cli/commands/context";
import { installCommand } from "#/cli/commands/install";
import { defineValidatedCommand } from "#/cli/command";
import { setDebug } from "#/lib/logger";
import * as z from "zod";
import pkg from "../../package.json";

const mainArgsSchema = z.object({
  debug: z.boolean().default(false),
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
  },
  setup({ args }) {
    if (args.debug) {
      setDebug(true);
    }
  },
  subCommands: {
    init: initCommand,
    project: projectCommand,
    prd: prdCommand,
    task: taskCommand,
    log: logCommand,
    handoff: handoffCommand,
    context: contextCommand,
    install: installCommand,
  },
});

runMain(main);
