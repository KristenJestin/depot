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
 * Explicit close-intent markers (FR + EN, the team's franglais). A `prd done`
 * confirmation quote must contain one of these.
 *
 * The presence check (`requireUserConfirmation`) only proves the agent quoted
 * *something*; it accepts "ok" or "go". That is fine for opening a PRD or
 * launching execution, but closing a PRD is terminal — and an agent will
 * happily repurpose a casual "ok pour moi commit tout" as the close quote. So
 * `prd done` additionally requires the quote to carry explicit close intent.
 * The list is deliberately small and strong (rarely ambiguous in this context);
 * false negatives are the safe direction — they make the agent ask the user to
 * confirm the closure explicitly rather than guess.
 */
const CLOSE_INTENT_PATTERNS: readonly RegExp[] = [
  /\bdone\b/, // "done le prd", "marque done", "passe en done"
  /cl[oô]tur/, // clôture, clôturer, cloturer
  /\bclose\b/, // "close the prd"
  /\bship\b/, // "ship it", "on ship"
  /finalis/, // finalise, finaliser
];

function normalizeConfirmation(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Whether `quote` explicitly expresses intent to close/finish the PRD, as
 * opposed to a generic acknowledgement ("ok", "c'est bon pour moi") or an
 * approval scoped to a different step ("commit tout"). Gates `prd done`.
 */
export function hasExplicitCloseIntent(quote: string): boolean {
  const normalized = normalizeConfirmation(quote);
  if (normalized.length === 0) return false;
  return CLOSE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Guidance shown when a `prd done` confirmation carries no close intent. */
export function explicitCloseConfirmationMessage(commandPath: string): string {
  return (
    `${commandPath} needs an explicit confirmation that the PRD is to be CLOSED. ` +
    `A generic approval — "ok", "c'est bon pour moi", "commit tout" — authorises that step, not closing the PRD. ` +
    `Ask the user to confirm explicitly (e.g. "done le PRD", "on clôture", "ship it"), then pass that verbatim quote to --user-confirmed. ` +
    `Tests/admin may set ${BYPASS_ENV_VAR}=1 to skip this gate.`
  );
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
