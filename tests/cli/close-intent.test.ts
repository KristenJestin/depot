import { describe, it, expect } from "vite-plus/test";
import { hasExplicitCloseIntent } from "#/cli/user-confirmation";

/**
 * `prd done` requires the `--user-confirmed` quote to carry explicit intent to
 * CLOSE the PRD, so an agent cannot repurpose a casual "ok" / commit approval
 * as a close-confirmation (the nyx/bterm dogfooding report).
 */
describe("hasExplicitCloseIntent", () => {
  it("accepts quotes that explicitly say to close/finish the PRD", () => {
    for (const quote of [
      "done",
      "done le PRD",
      "ok, marque-le done",
      "on clôture",
      "on cloture le prd",
      "clôturer",
      "ship it",
      "close the PRD",
      "finalise ça",
      "go ahead, mark it done",
    ]) {
      expect(hasExplicitCloseIntent(quote)).toBe(true);
    }
  });

  it("rejects generic approvals and step-scoped acknowledgements", () => {
    for (const quote of [
      "",
      "   ",
      "ok",
      "ok pour moi",
      "ok pour moi, commit tout",
      "c'est bon pour moi",
      "go",
      "vas-y",
      "parfait",
      "super, merci",
      "lgtm",
    ]) {
      expect(hasExplicitCloseIntent(quote)).toBe(false);
    }
  });
});
