import { runMain } from "citty";
import { Schema } from "effect";
import { initCommand, projectCommand } from "./commands/projects";
import { prdCommand } from "./commands/prds";
import { taskCommand } from "./commands/tasks";
import { logCommand } from "./commands/activity";
import { contextCommand } from "./commands/context";
import { installCommand } from "./commands/install";
import { workspaceCommand } from "./commands/workspaces";
import { reviewCommand } from "./commands/reviews";
import { serveCommand } from "./commands/serve";
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
    review: reviewCommand,
    serve: serveCommand,
  },
});

runMain(main);
