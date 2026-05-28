import { currentDbMode } from "#/db/client";

const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

function isQuiet(): boolean {
  if (process.env["DEPOT_QUIET"] === "1") {
    return true;
  }
  // Only scan up to the `--` separator. A user-supplied value placed after
  // `--` (e.g. `depot prd update <id> -- --json`) is documented as opaque to
  // the CLI parser and must not silence the prod-DB banner. argv[0]=node,
  // argv[1]=script path, so user tokens start at index 2.
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]!;
    if (arg === "--") return false;
    if (arg === "--json" || arg === "--json=true") return true;
  }
  return false;
}

/**
 * Emit a one-line stderr banner identifying which database the CLI is about
 * to open. Helps prevent accidental writes against `~/.depot/depot.db` from
 * inside a worktree that forgot to set `DEPOT_DB_PATH`.
 *
 * Silent when `DEPOT_QUIET=1` or when `--json` is passed (machine output).
 *
 * The `prod` banner is highlighted yellow on a TTY (or prefixed with
 * `WARNING: ` otherwise) because that is the case the developer most often
 * wants to catch.
 *
 * Also emits a deprecation warning when the legacy `DB_PATH` was honoured.
 */
export function logDbBoot(): void {
  if (isQuiet()) {
    return;
  }

  const mode = currentDbMode();
  const usedLegacy = !process.env["DEPOT_DB_PATH"] && Boolean(process.env["DB_PATH"]);

  if (mode.kind === "prod") {
    const line = `[depot] DB: prod (${mode.path})`;
    if (process.stderr.isTTY) {
      process.stderr.write(`${YELLOW}${line}${RESET}\n`);
    } else {
      process.stderr.write(`WARNING: ${line}\n`);
    }
  } else {
    process.stderr.write(`[depot] DB: ${mode.kind} (${mode.path})\n`);
  }

  if (usedLegacy) {
    process.stderr.write("[depot] WARN: DB_PATH is deprecated, use DEPOT_DB_PATH instead.\n");
  }
}
