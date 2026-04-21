import { describe, it, expect } from "vitest";
import {
  effortSchema,
  eventTypeSchema,
  nonEmptyString,
  jsonString,
  parseJsonLike,
  commaSeparatedIds,
} from "#/lib/schemas";

describe("effortSchema", () => {
  it("accepts valid effort values", () => {
    for (const val of ["xs", "s", "m", "l", "xl"]) {
      expect(effortSchema.parse(val)).toBe(val);
    }
  });

  it("rejects invalid effort values", () => {
    expect(() => effortSchema.parse("xxl")).toThrow(/invalid option/i);
    expect(() => effortSchema.parse("")).toThrow(/invalid option/i);
  });
});

describe("eventTypeSchema", () => {
  it("accepts valid event types", () => {
    for (const val of ["session_start", "note", "error", "handoff"]) {
      expect(eventTypeSchema.parse(val)).toBe(val);
    }
  });

  it("rejects invalid event types", () => {
    expect(() => eventTypeSchema.parse("invalid_type")).toThrow(/invalid option/i);
  });
});

describe("nonEmptyString", () => {
  it("accepts non-empty strings", () => {
    expect(nonEmptyString.parse("hello")).toBe("hello");
  });

  it("rejects empty strings", () => {
    expect(() => nonEmptyString.parse("")).toThrow(/must not be empty/i);
  });
});

describe("jsonString", () => {
  it("parses valid JSON", () => {
    const result = jsonString.parse('{"key": "value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("rejects invalid JSON", () => {
    expect(() => jsonString.parse("not json")).toThrow(/invalid json/i);
  });

  it("accepts PowerShell-mangled object literals", () => {
    const result = jsonString.parse(
      "{message:hello world,count:1,ok:true,nested:{value:test value},items:[1,2,three four]}",
    );
    expect(result).toEqual({
      message: "hello world",
      count: 1,
      ok: true,
      nested: { value: "test value" },
      items: [1, 2, "three four"],
    });
  });
});

describe("parseJsonLike", () => {
  it("parses standard JSON unchanged", () => {
    expect(parseJsonLike('{"key":"value"}')).toEqual({ key: "value" });
  });

  it("normalizes PowerShell-stripped quotes", () => {
    expect(parseJsonLike("{message:hello world}")).toEqual({ message: "hello world" });
  });
});

describe("commaSeparatedIds", () => {
  it("splits comma-separated values", () => {
    expect(commaSeparatedIds.parse("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace", () => {
    expect(commaSeparatedIds.parse("a, b , c")).toEqual(["a", "b", "c"]);
  });

  it("returns undefined for undefined input", () => {
    expect(commaSeparatedIds.parse(undefined)).toBeUndefined();
  });

  it("filters empty segments", () => {
    expect(commaSeparatedIds.parse("a,,b")).toEqual(["a", "b"]);
  });
});
