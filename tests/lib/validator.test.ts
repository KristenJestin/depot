import { describe, it, expect } from "vitest";
import {
  validatePrdTransition,
  validateTaskTransition,
  validateEffort,
  validateNonEmpty,
  validateEventType,
} from "#/lib/validator";

describe("validatePrdTransition", () => {
  it("allows draft -> committed", () => {
    expect(() => validatePrdTransition("draft", "committed")).not.toThrow();
  });

  it("allows committed -> in_progress", () => {
    expect(() => validatePrdTransition("committed", "in_progress")).not.toThrow();
  });

  it("allows committed -> archived", () => {
    expect(() => validatePrdTransition("committed", "archived")).not.toThrow();
  });

  it("allows in_progress -> archived", () => {
    expect(() => validatePrdTransition("in_progress", "archived")).not.toThrow();
  });

  it("rejects draft -> in_progress", () => {
    expect(() => validatePrdTransition("draft", "in_progress")).toThrow();
  });

  it("rejects archived -> draft", () => {
    expect(() => validatePrdTransition("archived", "draft")).toThrow();
  });

  it("rejects committed -> draft", () => {
    expect(() => validatePrdTransition("committed", "draft")).toThrow();
  });
});

describe("validateTaskTransition", () => {
  it("allows pending -> in_progress", () => {
    expect(() => validateTaskTransition("pending", "in_progress")).not.toThrow();
  });

  it("allows pending -> skipped", () => {
    expect(() => validateTaskTransition("pending", "skipped")).not.toThrow();
  });

  it("allows in_progress -> done", () => {
    expect(() => validateTaskTransition("in_progress", "done")).not.toThrow();
  });

  it("allows in_progress -> blocked", () => {
    expect(() => validateTaskTransition("in_progress", "blocked")).not.toThrow();
  });

  it("allows blocked -> in_progress", () => {
    expect(() => validateTaskTransition("blocked", "in_progress")).not.toThrow();
  });

  it("allows blocked -> skipped", () => {
    expect(() => validateTaskTransition("blocked", "skipped")).not.toThrow();
  });

  it("rejects pending -> done", () => {
    expect(() => validateTaskTransition("pending", "done")).toThrow();
  });

  it("rejects done -> pending", () => {
    expect(() => validateTaskTransition("done", "pending")).toThrow();
  });

  it("rejects done -> in_progress", () => {
    expect(() => validateTaskTransition("done", "in_progress")).toThrow();
  });

  it("rejects skipped -> pending", () => {
    expect(() => validateTaskTransition("skipped", "pending")).toThrow();
  });
});

describe("validateEffort", () => {
  it("accepts valid effort values", () => {
    for (const v of ["xs", "s", "m", "l", "xl"]) {
      expect(() => validateEffort(v)).not.toThrow();
    }
  });

  it("rejects invalid effort values", () => {
    expect(() => validateEffort("medium")).toThrow();
    expect(() => validateEffort("")).toThrow();
    expect(() => validateEffort("xxl")).toThrow();
  });
});

describe("validateNonEmpty", () => {
  it("accepts non-empty strings", () => {
    expect(() => validateNonEmpty("hello", "field")).not.toThrow();
  });

  it("rejects empty strings", () => {
    expect(() => validateNonEmpty("", "field")).toThrow(/field/);
  });

  it("rejects whitespace-only strings", () => {
    expect(() => validateNonEmpty("   ", "field")).toThrow(/field/);
  });
});

describe("validateEventType", () => {
  it("accepts valid event types", () => {
    const valid = [
      "session_start",
      "task_started",
      "task_done",
      "task_blocked",
      "task_skipped",
      "prd_committed",
      "prd_activated",
      "prd_amended",
      "note",
      "handoff",
      "error",
    ];
    for (const t of valid) {
      expect(() => validateEventType(t)).not.toThrow();
    }
  });

  it("rejects invalid event types", () => {
    expect(() => validateEventType("random")).toThrow();
    expect(() => validateEventType("")).toThrow();
  });
});
