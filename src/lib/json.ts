import { Schema, Either } from "effect";

/**
 * Parses a raw JSON string and validates the result against the given Effect Schema.
 * Returns a typed Either: Left contains a structured error, Right the decoded value.
 */
export function parseJsonSchema<A>(
  raw: string,
  schema: Schema.Schema<A, any, never>,
):
  | { ok: true; data: A }
  | { ok: false; kind: "invalid_json" | "validation_error"; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      kind: "invalid_json",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const result = Schema.decodeUnknownEither(schema)(parsed);
  if (Either.isLeft(result)) {
    return {
      ok: false,
      kind: "validation_error",
      message: result.left.message,
    };
  }

  return { ok: true, data: result.right };
}
