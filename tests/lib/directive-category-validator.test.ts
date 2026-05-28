import { describe, it, expect } from "vite-plus/test";
import {
  VALID_DIRECTIVE_CATEGORIES,
  VALID_DIRECTIVE_SCOPES,
  VALID_CATEGORY_SCOPES,
  isValidCategoryScope,
  validScopesForCategory,
  type DirectiveCategory,
  type DirectiveScope,
} from "#/shared/validator";

describe("directive (category, scope) validator (PRD 0013 / T1)", () => {
  it("exposes the 6 canonical categories", () => {
    expect(VALID_DIRECTIVE_CATEGORIES).toEqual(["prd", "dev", "coder", "auditor", "doc", "ship"]);
  });

  it("recognises the 4 new orchestrator-flow scopes alongside the legacy ones", () => {
    expect(VALID_DIRECTIVE_SCOPES).toContain("pre-coder-spawn");
    expect(VALID_DIRECTIVE_SCOPES).toContain("post-auditor-pass");
    expect(VALID_DIRECTIVE_SCOPES).toContain("pre-handoff");
    expect(VALID_DIRECTIVE_SCOPES).toContain("pre-phase-advance");
    expect(VALID_DIRECTIVE_SCOPES).toContain("always");
    expect(VALID_DIRECTIVE_SCOPES).toContain("pre-review");
    expect(VALID_DIRECTIVE_SCOPES).toContain("pre-commit");
    expect(VALID_DIRECTIVE_SCOPES).toContain("pre-doc-sync");
    expect(VALID_DIRECTIVE_SCOPES).toContain("pre-ship");
    expect(VALID_DIRECTIVE_SCOPES).toContain("on-error");
  });

  it("accepts every (category, scope) combination listed in the spec", () => {
    const expected: Array<[DirectiveCategory, DirectiveScope]> = [
      ["prd", "always"],
      ["dev", "always"],
      ["dev", "pre-coder-spawn"],
      ["dev", "pre-review"],
      ["dev", "post-auditor-pass"],
      ["dev", "pre-handoff"],
      ["dev", "pre-phase-advance"],
      ["coder", "always"],
      ["coder", "pre-commit"],
      ["auditor", "always"],
      ["auditor", "pre-review"],
      ["doc", "always"],
      ["doc", "pre-doc-sync"],
      ["ship", "always"],
      ["ship", "pre-ship"],
    ];
    expect(expected).toHaveLength(15);
    for (const [category, scope] of expected) {
      expect(isValidCategoryScope(category, scope)).toBe(true);
    }
  });

  it("agrees with VALID_CATEGORY_SCOPES (the lookup table) for every (cat, scope) pair", () => {
    let validCount = 0;
    for (const category of VALID_DIRECTIVE_CATEGORIES) {
      for (const scope of VALID_DIRECTIVE_SCOPES) {
        const fromTable = VALID_CATEGORY_SCOPES[category].includes(scope);
        expect(isValidCategoryScope(category, scope)).toBe(fromTable);
        if (fromTable) validCount += 1;
      }
    }
    expect(validCount).toBe(15);
  });

  it("rejects representative invalid combinations", () => {
    expect(isValidCategoryScope("prd", "pre-commit")).toBe(false);
    expect(isValidCategoryScope("prd", "pre-review")).toBe(false);
    expect(isValidCategoryScope("doc", "pre-ship")).toBe(false);
    expect(isValidCategoryScope("ship", "pre-doc-sync")).toBe(false);
    expect(isValidCategoryScope("coder", "pre-review")).toBe(false);
    expect(isValidCategoryScope("coder", "pre-doc-sync")).toBe(false);
    expect(isValidCategoryScope("auditor", "pre-commit")).toBe(false);
    expect(isValidCategoryScope("auditor", "pre-doc-sync")).toBe(false);
    expect(isValidCategoryScope("dev", "pre-doc-sync")).toBe(false);
    expect(isValidCategoryScope("dev", "pre-commit")).toBe(false);
    expect(isValidCategoryScope("dev", "pre-ship")).toBe(false);
    expect(isValidCategoryScope("dev", "on-error")).toBe(false);
  });

  it("validScopesForCategory returns the lookup table entry verbatim", () => {
    expect(validScopesForCategory("prd")).toEqual(["always"]);
    expect(validScopesForCategory("dev")).toEqual([
      "always",
      "pre-coder-spawn",
      "pre-review",
      "post-auditor-pass",
      "pre-handoff",
      "pre-phase-advance",
    ]);
    expect(validScopesForCategory("coder")).toEqual(["always", "pre-commit"]);
    expect(validScopesForCategory("auditor")).toEqual(["always", "pre-review"]);
    expect(validScopesForCategory("doc")).toEqual(["always", "pre-doc-sync"]);
    expect(validScopesForCategory("ship")).toEqual(["always", "pre-ship"]);
  });
});
