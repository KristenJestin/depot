import { Effect, Schema } from "effect";
import { eq } from "drizzle-orm";
import { runEffect } from "#/cli/runtime";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { activityLog } from "#/db/schema";
import type { CommandOutput } from "#/cli/command";
import type { EventType } from "#/shared/validator";

const BYPASS_ENV_VAR = "DEPOT_BYPASS_USER_CONFIRMATION";

/**
 * Reusable schema for the `--user-confirmed` flag. We accept any string here
 * (the non-empty-after-trim check is performed manually so we can emit a
 * guidance-rich error message) and rely on `resolveUserConfirmation` for the
 * policy checks.
 */
export const userConfirmedArg = {
  schema: Schema.String,
  description:
    'Verbatim user approval quote (any non-empty string, even short like "go"). Required unless DEPOT_BYPASS_USER_CONFIRMATION=1 is set.',
} as const;

type ResolveResult =
  | { ok: true; userConfirmation: string | null }
  | { ok: false; code: string; message: string };

function isBypassActive(): boolean {
  return process.env[BYPASS_ENV_VAR] === "1";
}

function buildPolicyMessage(commandPath: string): string {
  return (
    `${commandPath} requires --user-confirmed "<quote>" — pass a verbatim quote of the user's approval, ` +
    `even if short. Empty values are rejected. ` +
    `Tests and admin scripts may set DEPOT_BYPASS_USER_CONFIRMATION=1 to skip this gate.`
  );
}

/**
 * Apply the `--user-confirmed` policy:
 *
 * - flag absent + bypass env unset → reject with a guidance message.
 * - flag empty after trim          → reject with the same guidance.
 * - flag valid (non-empty trim)    → resolve to the literal quote (unmodified).
 * - flag absent + bypass env set   → resolve to `null` (audit log keeps the null).
 */
export function resolveUserConfirmation(
  rawValue: string | undefined,
  commandPath: string,
): ResolveResult {
  if (rawValue === undefined) {
    if (isBypassActive()) {
      return { ok: true, userConfirmation: null };
    }
    return {
      ok: false,
      code: "user_confirmation_required",
      message: buildPolicyMessage(commandPath),
    };
  }
  if (rawValue.trim().length === 0) {
    return {
      ok: false,
      code: "user_confirmation_empty",
      message: buildPolicyMessage(commandPath),
    };
  }
  return { ok: true, userConfirmation: rawValue };
}

/**
 * Run `resolveUserConfirmation` and route a failure through `output.error`
 * (which terminates the process). On success, return the resolved value.
 *
 * The helper exists so each CLI command can opt into the policy with a single
 * line at the top of its `run` handler.
 */
export function requireUserConfirmation(
  args: { userConfirmed?: string },
  commandPath: string,
  output: CommandOutput,
): string | null {
  const result = resolveUserConfirmation(args.userConfirmed, commandPath);
  if (!result.ok) {
    output.error(result.code, result.message);
  }
  return result.userConfirmation;
}

/**
 * Patch the most recent `activity_log` row for `(prdRevisionId, eventType)`
 * to add a `userConfirmation` field on the JSON payload. Used as a post-hook
 * after a domain transition function returns so the CLI can attach the user's
 * approval quote without changing the domain function signature.
 *
 * Silently no-ops if no row matches (e.g. the domain swallowed its own log
 * insert): the audit annotation is a best-effort enrichment, not a hard
 * invariant.
 */
export function attachUserConfirmationToLatestActivity(
  prdRevisionId: string,
  eventType: EventType,
  userConfirmation: string | null,
): Promise<void> {
  return runEffect(
    Effect.gen(function* () {
      const db = yield* Db;
      const row = yield* dbQuery(() =>
        db.query.activityLog.findFirst({
          where: { prdRevisionId, eventType },
          orderBy: { id: "desc" },
        }),
      );
      if (!row) return;
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(row.payload) as unknown;
        payload =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
      } catch {
        payload = {};
      }
      payload["userConfirmation"] = userConfirmation;
      yield* dbQuery(() =>
        db
          .update(activityLog)
          .set({ payload: JSON.stringify(payload) })
          .where(eq(activityLog.id, row.id)),
      );
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
  );
}
