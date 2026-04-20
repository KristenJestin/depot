import { defineCommand, runMain } from "citty";
import { initCommand, projectCommand } from "#/cli/commands/project";
import { prdCommand } from "#/cli/commands/prd";
import { taskCommand } from "#/cli/commands/task";
import { logCommand } from "#/cli/commands/log";
import { handoffCommand } from "#/cli/commands/handoff";
import { playbookCommand } from "#/cli/commands/playbook";
import { setDebug } from "#/lib/logger";
import pkg from "../../package.json";

const main = defineCommand({
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
    playbook: playbookCommand,
  },
});

runMain(main);
