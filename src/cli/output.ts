import { isJsonMode } from "#/lib/logger";

// ── JSON envelope types ───────────────────────────────────────────────────────

export type JsonSuccess<T> = { kind: "success"; payload: T };
export type JsonError = { kind: "error"; error: { code: string; message: string } };
export type JsonEnvelope<T> = JsonSuccess<T> | JsonError;

// ── Output helpers ────────────────────────────────────────────────────────────

/**
 * Emit a success envelope to stdout in JSON mode.
 * In text mode this is a no-op; the caller must print human-readable output instead.
 */
export function outputSuccess<T>(payload: T): void {
  process.stdout.write(JSON.stringify({ kind: "success", payload }) + "\n");
}

/**
 * Emit an error envelope to stdout and exit with code 1.
 * Works in both JSON mode (structured envelope) and text mode (plain message to stderr).
 */
export function outputError(code: string, message: string): never {
  if (isJsonMode()) {
    process.stdout.write(JSON.stringify({ kind: "error", error: { code, message } }) + "\n");
  } else {
    console.error(message);
  }
  process.exit(1);
}

export { isJsonMode };
