import * as z from "zod";
import { VALID_EFFORTS, VALID_EVENT_TYPES } from "#/lib/validator";
import { isJsonMode } from "#/lib/logger";

function parseLooseJsonLike(input: string): Record<string, unknown> {
  let index = 0;

  function skipWhitespace(): void {
    while (index < input.length && /\s/.test(input[index]!)) {
      index += 1;
    }
  }

  function expectChar(char: string): void {
    skipWhitespace();
    if (input[index] !== char) {
      throw new Error(`Expected '${char}' at position ${index}`);
    }
    index += 1;
  }

  function parseQuotedString(): string {
    const quote = input[index]!;
    index += 1;
    let value = "";

    while (index < input.length) {
      const char = input[index]!;
      if (char === "\\") {
        const next = input[index + 1];
        if (next) {
          value += next;
          index += 2;
          continue;
        }
      }
      if (char === quote) {
        index += 1;
        return value;
      }
      value += char;
      index += 1;
    }

    throw new Error("Unterminated string literal");
  }

  function parseBareToken(): unknown {
    const start = index;
    while (index < input.length && ![",", "}", "]"].includes(input[index]!)) {
      index += 1;
    }

    const raw = input.slice(start, index).trim();
    if (raw === "") {
      throw new Error(`Unexpected empty token at position ${start}`);
    }
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      return Number(raw);
    }

    return raw;
  }

  function parseArray(): unknown[] {
    expectChar("[");
    const items: unknown[] = [];
    skipWhitespace();
    if (input[index] === "]") {
      index += 1;
      return items;
    }

    while (index < input.length) {
      items.push(parseValue());
      skipWhitespace();
      if (input[index] === ",") {
        index += 1;
        continue;
      }
      if (input[index] === "]") {
        index += 1;
        return items;
      }
      throw new Error(`Expected ',' or ']' at position ${index}`);
    }

    throw new Error("Unterminated array literal");
  }

  function parseKey(): string {
    skipWhitespace();
    const current = input[index];
    if (current === '"' || current === "'") {
      return parseQuotedString();
    }

    const start = index;
    while (index < input.length && input[index] !== ":") {
      index += 1;
    }
    const key = input.slice(start, index).trim();
    if (!key) {
      throw new Error(`Expected object key at position ${start}`);
    }
    return key;
  }

  function parseObject(): Record<string, unknown> {
    expectChar("{");
    const result: Record<string, unknown> = {};
    skipWhitespace();
    if (input[index] === "}") {
      index += 1;
      return result;
    }

    while (index < input.length) {
      const key = parseKey();
      expectChar(":");
      result[key] = parseValue();
      skipWhitespace();
      if (input[index] === ",") {
        index += 1;
        continue;
      }
      if (input[index] === "}") {
        index += 1;
        return result;
      }
      throw new Error(`Expected ',' or '}' at position ${index}`);
    }

    throw new Error("Unterminated object literal");
  }

  function parseValue(): unknown {
    skipWhitespace();
    const current = input[index];
    if (current === "{") return parseObject();
    if (current === "[") return parseArray();
    if (current === '"' || current === "'") return parseQuotedString();
    return parseBareToken();
  }

  const value = parseValue();
  skipWhitespace();
  if (index !== input.length) {
    throw new Error(`Unexpected trailing content at position ${index}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Payload must be a JSON object");
  }

  return value as Record<string, unknown>;
}

export function parseJsonLike(val: string): Record<string, unknown> {
  try {
    return JSON.parse(val) as Record<string, unknown>;
  } catch {
    return parseLooseJsonLike(val);
  }
}

// ── Field schemas ─────────────────────────────────────────────────────────────

// Single source of truth: enum values come from validator.ts constants.
export const effortSchema = z.enum(VALID_EFFORTS);
export const eventTypeSchema = z.enum(VALID_EVENT_TYPES);

export const nonEmptyString = z.string().min(1, "Must not be empty");

export const jsonString = z.string().transform((val, ctx) => {
  try {
    return parseJsonLike(val);
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
 * In JSON mode, emits a structured error envelope to stdout instead.
 */
export function validateArgs<T extends z.ZodTypeAny>(schema: T, args: unknown): z.infer<T> {
  const result = schema.safeParse(args);
  if (!result.success) {
    if (isJsonMode()) {
      const message = result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "input";
          return `${path}: ${issue.message}`;
        })
        .join("; ");
      process.stdout.write(
        JSON.stringify({ kind: "error", error: { code: "validation_error", message } }) + "\n",
      );
    } else {
      for (const issue of result.error.issues) {
        const path = issue.path.length > 0 ? issue.path.join(".") : "input";
        console.error(`Validation error (${path}): ${issue.message}`);
      }
    }
    process.exit(1);
  }
  return result.data;
}
