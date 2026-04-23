import { runMain } from "citty";
import { Schema } from "effect";
import { initCommand, projectCommand } from "#/modules/projects/command";
import { prdCommand } from "#/modules/prds/command";
import { taskCommand } from "#/modules/tasks/command";
import { logCommand } from "#/modules/activity/command";
import { contextCommand } from "#/modules/context/command";
import { installCommand } from "#/modules/install/command";
import { workspaceCommand } from "#/modules/workspaces/command";
import { command } from "#/cli/command";
import { setDebug, setJsonMode } from "#/shared/logger";
import pkg from "../../package.json";

const main = command({
  meta: {
    name: "depot",
    version: pkg.version,
    description: "AI agent task and PRD management CLI",
  },
  args: {
    debug: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Enable verbose debug output",
    },
    json: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON output on stdout",
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
    context: contextCommand,
    install: installCommand,
  },
});

runMain(main);
