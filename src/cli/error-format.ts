import { Cause, Runtime } from "effect";
import { currentDbMode } from "#/db/client";
import { CrossEntityError, DatabaseError, ValidationError } from "#/shared/errors";

/**
 * Output of {@link formatError} — a one-line `Error: …` summary suitable for
 * stderr and, optionally, a verbose `debug` blob (raw stack and effect cause)
 * the caller can choose to print under `DEPOT_DEBUG=1`.
 */
export type FormattedError = {
  line: string;
  debug?: string;
};

/**
 * Options that influence the visible (`line`) portion of the formatted error.
 *
 * - `quiet`: suppress the `Hint: …` suffix on database errors. Used when the
 *   CLI is in `--json`/`DEPOT_QUIET=1` mode so the stderr output stays
 *   single-line and machine-parseable.
 * - `dbPath`: override the DB path included in `DatabaseError` lines. Lets
 *   callers thread an explicit path through tests without poking at env vars.
 */
export type FormatOptions = {
  quiet?: boolean;
  dbPath?: string;
};

/**
 * Render any error the depot CLI might surface (effect `FiberFailure` blobs,
 * tagged `DatabaseError`/`ValidationError`/`CrossEntityError`, other tagged
 * errors carrying a `message`, or plain `Error`/unknown values) into a single
 * readable `Error: …` line plus an optional verbose debug blob.
 *
 * The function never throws; if it cannot extract anything sensible from the
 * input it falls back to `Error: unexpected error: <String(err)>`.
 */
export function formatError(err: unknown, options: FormatOptions = {}): FormattedError {
  const debug = buildDebug(err);
  const unwrapped = unwrapFiberFailure(err);

  if (unwrapped instanceof DatabaseError) {
    return { line: formatDatabaseLine(unwrapped, options), debug };
  }

  if (unwrapped instanceof ValidationError) {
    return { line: `Error: ${unwrapped.message}`, debug };
  }

  if (unwrapped instanceof CrossEntityError) {
    return { line: `Error: ${unwrapped.message}`, debug };
  }

  if (isTaggedDepotError(unwrapped)) {
    return { line: `Error: ${unwrapped._tag}: ${unwrapped.message}`, debug };
  }

  if (unwrapped instanceof Error) {
    return { line: `Error: unexpected error: ${unwrapped.message}`, debug };
  }

  return { line: `Error: unexpected error: ${String(unwrapped)}`, debug };
}

function formatDatabaseLine(err: DatabaseError, options: FormatOptions): string {
  const path = options.dbPath ?? err.path ?? currentDbMode().path;
  const underlying = err.cause instanceof Error ? err.cause.message : String(err.cause);
  const head = `Error: ${underlying} (DB: ${path}, kind: database)`;
  if (options.quiet) {
    return head;
  }
  const hint = suggestHint(underlying, path);
  return hint ? `${head}\nHint: ${hint}` : head;
}

function suggestHint(message: string, path: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("file is not a database")) {
    return `The file at ${path} exists but is not a valid SQLite database. Inspect or remove it and re-run.`;
  }
  if (
    lower.includes("attempt to write a readonly database") ||
    lower.includes("readonly database")
  ) {
    return `The database file at ${path} is read-only (permissions). Adjust with chmod or move to a writable location.`;
  }
  if (lower.includes("database is locked")) {
    return "Another process is writing to the database. Retry in a moment.";
  }
  return null;
}

/**
 * Effect surfaces failed effects to `runPromise` as a `FiberFailure` (an Error
 * carrying a `Cause` under a symbol key). Unwrap one layer so domain-typed
 * errors (DatabaseError, ValidationError, …) are visible to the matchers
 * above. Anything else passes through unchanged.
 */
function unwrapFiberFailure(err: unknown): unknown {
  if (!Runtime.isFiberFailure(err)) {
    return err;
  }
  const cause = err[Runtime.FiberFailureCauseId];
  return extractFromCause(cause) ?? err;
}

function extractFromCause(cause: Cause.Cause<unknown>): unknown {
  const failures = Cause.failures(cause);
  for (const failure of failures) {
    if (failure !== null && failure !== undefined) {
      return failure;
    }
  }
  const defects = Cause.defects(cause);
  for (const defect of defects) {
    if (defect !== null && defect !== undefined) {
      return defect;
    }
  }
  return null;
}

function isTaggedDepotError(err: unknown): err is { _tag: string; message: string } {
  if (typeof err !== "object" || err === null) return false;
  const tag = (err as { _tag?: unknown })._tag;
  const message = (err as { message?: unknown }).message;
  return typeof tag === "string" && typeof message === "string";
}

function buildDebug(err: unknown): string | undefined {
  if (err instanceof Error && typeof err.stack === "string") {
    return err.stack;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
