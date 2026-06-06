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
import { docCommand } from "./commands/docs";
import { pendingCommand } from "./commands/pending";
import { serveCommand } from "./commands/serve";
import { adrCommand } from "./commands/adrs";
import { ideaCommand } from "./commands/idea";
import { command } from "#/cli/command";
import { formatError } from "#/cli/error-format";
import { setDebug, setJsonMode } from "#/shared/logger";
import { logDbBoot } from "#/cli/log-db-boot";
import pkg from "../../package.json";

process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning") return;
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});

if (!process.stdout.isTTY && !process.env["NO_COLOR"] && !process.env["FORCE_COLOR"]) {
  process.env["NO_COLOR"] = "1";
}

logDbBoot();

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
    doc: docCommand,
    pending: pendingCommand,
    serve: serveCommand,
    adr: adrCommand,
    idea: ideaCommand,
  },
});

runDepotCli();

/**
 * Wrap citty's `runMain` so the raw `(FiberFailure)` blob it would otherwise
 * `console.error` is replaced by a single, readable line produced by
 * {@link formatError}.
 *
 * citty's runMain has its own try/catch and calls `process.exit(1)` itself
 * — it never re-throws — so the only seam we have without forking citty is
 * its `console.error` call site. We swap `console.error` for the duration of
 * runMain and route the first error-shaped argument through our formatter.
 * Errors raised by `CLIError` (citty's own "missing required arg" / "unknown
 * command" messages) come in as plain strings after a `showUsage` block and
 * are passed through unchanged.
 */
async function runDepotCli(): Promise<void> {
  const originalConsoleError = console.error;

  console.error = (...args: unknown[]) => {
    const candidate = args[0];
    if (candidate instanceof Error && !isCittyUsageError(candidate)) {
      emitFormattedError(candidate);
      return;
    }
    originalConsoleError(...args);
  };

  try {
    await runMain(main);
  } finally {
    console.error = originalConsoleError;
  }
}

function isCittyUsageError(err: Error): boolean {
  return err.name === "CLIError";
}

function emitFormattedError(err: unknown): void {
  const argv = process.argv.slice(2);
  const quiet =
    process.env["DEPOT_QUIET"] === "1" || argv.some((arg) => arg === "--json" || arg === "-j");
  const { line, debug } = formatError(err, { quiet });
  process.stderr.write(`${line}\n`);
  if (process.env["DEPOT_DEBUG"] === "1" && debug) {
    process.stderr.write(`${debug}\n`);
  }
}
