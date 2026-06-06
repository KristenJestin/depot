import { describe, it, expect } from "vite-plus/test";
import { resolvePort } from "#/cli/commands/serve";

describe("serve resolvePort", () => {
  it("prefers an explicit --port over everything", () => {
    expect(resolvePort(3000, "5000")).toBe(3000);
    expect(resolvePort(3000, undefined)).toBe(3000);
  });

  it("falls back to $PORT when --port is absent", () => {
    expect(resolvePort(undefined, "5000")).toBe(5000);
  });

  it("ignores an invalid or non-positive $PORT and uses the default", () => {
    expect(resolvePort(undefined, "not-a-number")).toBe(4242);
    expect(resolvePort(undefined, "0")).toBe(4242);
    expect(resolvePort(undefined, "-1")).toBe(4242);
  });

  it("uses the default when neither --port nor $PORT is set", () => {
    expect(resolvePort(undefined, undefined)).toBe(4242);
  });
});
