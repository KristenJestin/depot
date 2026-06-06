import { Cause, Effect, Runtime } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { formatError } from "#/cli/error-format";
import {
  CrossEntityError,
  DatabaseError,
  PrdNotFoundError,
  ValidationError,
} from "#/shared/errors";

const DB_PATH = "/tmp/depot-tests/depot.db";

describe("formatError", () => {
  describe("DatabaseError", () => {
    it("renders a corrupted-db error with the DB path and a fix hint", () => {
      const err = new DatabaseError({
        cause: new Error("file is not a database"),
        path: DB_PATH,
        operation: "open",
      });

      const { line, debug } = formatError(err);

      expect(line).toContain("Error: file is not a database");
      expect(line).toContain(`DB: ${DB_PATH}`);
      expect(line).toContain("kind: database");
      expect(line).toContain("Hint:");
      expect(line).toContain("not a valid SQLite database");
      expect(line).toContain(DB_PATH);
      expect(line.split("\n")).toHaveLength(2);
      expect(debug).toBeTypeOf("string");
    });

    it("renders a readonly-db error with a chmod hint", () => {
      const err = new DatabaseError({
        cause: new Error("attempt to write a readonly database"),
        path: DB_PATH,
      });

      const { line } = formatError(err);

      expect(line).toContain("attempt to write a readonly database");
      expect(line).toContain("Hint:");
      expect(line.toLowerCase()).toContain("read-only");
      expect(line).toContain(DB_PATH);
    });

    it("renders a locked-db error with a retry hint", () => {
      const err = new DatabaseError({
        cause: new Error("database is locked"),
        path: DB_PATH,
      });

      const { line } = formatError(err);

      expect(line).toContain("database is locked");
      expect(line).toContain("Hint:");
      expect(line).toContain("Retry");
    });

    it("omits the Hint suffix in quiet mode", () => {
      const err = new DatabaseError({
        cause: new Error("file is not a database"),
        path: DB_PATH,
      });

      const { line } = formatError(err, { quiet: true });

      expect(line).toContain("Error: file is not a database");
      expect(line).not.toContain("Hint:");
      expect(line.split("\n")).toHaveLength(1);
    });

    it("falls back to the env-derived DB path when the error has none", () => {
      const previous = process.env["DEPOT_DB_PATH"];
      process.env["DEPOT_DB_PATH"] = "/tmp/fallback/depot.db";
      try {
        const err = new DatabaseError({ cause: new Error("disk I/O error") });
        const { line } = formatError(err);
        expect(line).toContain("DB: /tmp/fallback/depot.db");
      } finally {
        if (previous === undefined) {
          delete process.env["DEPOT_DB_PATH"];
        } else {
          process.env["DEPOT_DB_PATH"] = previous;
        }
      }
    });

    it("never includes the raw FiberFailure string in the visible line", () => {
      const inner = new DatabaseError({
        cause: new Error("file is not a database"),
        path: DB_PATH,
      });
      const fiberFailure = Runtime.makeFiberFailure(Cause.die(inner));

      const { line } = formatError(fiberFailure);

      expect(line).not.toContain("FiberFailure");
      expect(line).toContain("file is not a database");
      expect(line).toContain(`DB: ${DB_PATH}`);
    });
  });

  describe("ValidationError", () => {
    it("renders the raw reason on a single line", () => {
      const err = new ValidationError({ reason: "title is required" });
      const { line } = formatError(err);
      expect(line).toBe("Error: title is required");
    });

    it("unwraps a fiber-wrapped ValidationError", async () => {
      const failure = await Effect.runPromise(
        Effect.either(Effect.fail(new ValidationError({ reason: "bad input" }))),
      );
      if (failure._tag !== "Left") throw new Error("unreachable");
      // Re-throw via runPromise so we get a real FiberFailure value.
      const fiberFailure = await Effect.runPromise(
        Effect.fail(new ValidationError({ reason: "bad input" })),
      ).catch((e: unknown) => e);

      const { line } = formatError(fiberFailure);
      expect(line).toBe("Error: bad input");
      expect(line).not.toContain("FiberFailure");
    });
  });

  describe("CrossEntityError", () => {
    it("renders the enriched message verbatim", () => {
      const err = new CrossEntityError({
        reason: "PRD 'X' does not belong to workspace 'Y'",
      });
      const { line } = formatError(err);
      expect(line).toBe("Error: PRD 'X' does not belong to workspace 'Y'");
    });
  });

  describe("Tagged depot errors", () => {
    it("prefixes the error _tag", () => {
      const err = new PrdNotFoundError({ id: "prd-123" });
      const { line } = formatError(err);
      expect(line).toBe("Error: PrdNotFoundError: PRD not found: prd-123");
    });
  });

  describe("Unknown errors", () => {
    it("wraps a plain Error as `unexpected error: …`", () => {
      const { line, debug } = formatError(new Error("boom"));
      expect(line).toBe("Error: unexpected error: boom");
      expect(debug).toBeTypeOf("string");
      expect(debug).toContain("boom");
    });

    it("falls back to String(err) for non-Error values", () => {
      const { line } = formatError("string failure");
      expect(line).toBe("Error: unexpected error: string failure");
    });
  });
});
