import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { setDebug, isDebug, log } from "#/shared/logger";

describe("logger", () => {
  beforeEach(() => {
    setDebug(false);
  });

  // ── setDebug / isDebug ─────────────────────────────────────────────────────

  it("isDebug defaults to false", () => {
    expect(isDebug()).toBe(false);
  });

  it("setDebug enables debug mode", () => {
    setDebug(true);
    expect(isDebug()).toBe(true);
  });

  // ── log.debug ──────────────────────────────────────────────────────────────

  describe("log.debug", () => {
    it("does not output when debug is disabled", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      log.debug("test message");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("outputs to stderr with [debug] prefix when enabled", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      setDebug(true);
      log.debug("test message");
      expect(spy).toHaveBeenCalledWith("[debug]", "test message");
      spy.mockRestore();
    });
  });

  // ── log.info ───────────────────────────────────────────────────────────────

  describe("log.info", () => {
    it("outputs to stdout", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      log.info("hello world");
      expect(spy).toHaveBeenCalledWith("hello world");
      spy.mockRestore();
    });
  });

  // ── log.error ──────────────────────────────────────────────────────────────

  describe("log.error", () => {
    it("outputs to stderr", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      log.error("error message");
      expect(spy).toHaveBeenCalledWith("error message");
      spy.mockRestore();
    });
  });

  // ── log.fields ─────────────────────────────────────────────────────────────

  describe("log.fields", () => {
    it("outputs aligned key-value pairs", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      log.fields([
        ["ID", "abc123"],
        ["Title", "My Task"],
      ]);

      // "ID".padEnd(5) = "ID   ", then " : " separator → "ID    : abc123"
      // "Title".padEnd(5) = "Title", then " : " separator → "Title : My Task"
      expect(spy).toHaveBeenCalledWith("ID    : abc123");
      expect(spy).toHaveBeenCalledWith("Title : My Task");
      spy.mockRestore();
    });

    it("skips null and undefined values", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      log.fields([
        ["ID", "abc123"],
        ["Context", null],
        ["Scope", undefined],
      ]);

      // Only the non-null entry should be printed
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("does nothing with an empty array", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      log.fields([]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("does nothing when all values are null or undefined", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      log.fields([
        ["A", null],
        ["B", undefined],
      ]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
