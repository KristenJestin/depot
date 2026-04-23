import { Effect } from "effect";
import { DatabaseError } from "#/shared/errors";

/**
 * Wrap a raw Drizzle/Bun SQLite call in an Effect.
 * Single shared helper to avoid copy-pasting across domain modules.
 */
export const dbQuery = <A>(fn: () => Promise<A>): Effect.Effect<A, DatabaseError, never> =>
  Effect.tryPromise({ try: fn, catch: (e) => new DatabaseError({ cause: e }) });
