import * as z from "zod";
import { VALID_EFFORTS, VALID_EVENT_TYPES } from "#/lib/validator";

// ── Field schemas ─────────────────────────────────────────────────────────────

// Single source of truth: enum values come from validator.ts constants.
export const effortSchema = z.enum(VALID_EFFORTS);
export const eventTypeSchema = z.enum(VALID_EVENT_TYPES);

export const nonEmptyString = z.string().min(1, "Must not be empty");

export const jsonString = z.string().transform((val, ctx) => {
  try {
    return JSON.parse(val) as Record<string, unknown>;
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Invalid JSON",
    });
    return z.NEVER;
  }
});

export const commaSeparatedIds = z
  .string()
  .optional()
  .transform((val) =>
    val
      ? val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  );

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Validate args using a Zod schema inside a citty `setup` or `run` hook.
 * On failure, prints each validation error and exits with code 1.
 */
export function validateArgs<T extends z.ZodTypeAny>(schema: T, args: unknown): z.infer<T> {
  const result = schema.safeParse(args);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "input";
      console.error(`Validation error (${path}): ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}
