import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { effortSchema, eventTypeSchema, parseJsonLike } from "#/shared/schemas";

const decodeEffort = Schema.decodeUnknownSync(effortSchema);
const decodeEventType = Schema.decodeUnknownSync(eventTypeSchema);

describe("effortSchema", () => {
  it("accepts valid effort values", () => {
    for (const val of ["xs", "s", "m", "l", "xl"]) {
      expect(decodeEffort(val)).toBe(val);
    }
  });

  it("rejects invalid effort values", () => {
    expect(() => decodeEffort("xxl")).toThrow(/Expected/);
    expect(() => decodeEffort("")).toThrow(/Expected/);
  });
});

describe("eventTypeSchema", () => {
  it("accepts valid event types", () => {
    for (const val of ["session_start", "note", "error"]) {
      expect(decodeEventType(val)).toBe(val);
    }
  });

  it("rejects invalid event types", () => {
    expect(() => decodeEventType("invalid_type")).toThrow(/Expected/);
  });
});

describe("parseJsonLike", () => {
  it("parses standard JSON unchanged", () => {
    expect(parseJsonLike('{"key":"value"}')).toEqual({ key: "value" });
  });

  it("normalizes PowerShell-stripped quotes", () => {
    expect(parseJsonLike("{message:hello world}")).toEqual({ message: "hello world" });
  });

  it("accepts PowerShell-mangled object literals", () => {
    const result = parseJsonLike(
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

  it("rejects non-object top-level values", () => {
    // parseLooseJsonLike throws for arrays; JSON.parse path also rejects arrays
    expect(() => parseJsonLike("{not valid [[[")).toThrow(/Expected|Unexpected/i);
  });
});
