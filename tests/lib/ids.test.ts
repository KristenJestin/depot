import { describe, expect, it } from "vitest";
import { shortId, uniqueIdPrefix } from "#/lib/ids";

describe("ids", () => {
  it("keeps the shortId helper at 8 chars", () => {
    expect(shortId("01KPQJ1SCSNZJNHMEKJK91KF6M")).toBe("01KPQJ1S");
  });

  it("extends the displayed prefix until it is unique", () => {
    const ids = ["01KPQJ1SCSNZJNHMEKJK91KF6M", "01KPQJ1SEEBSTSWNWKVZQ35SWJ"];

    expect(uniqueIdPrefix(ids[0]!, ids)).toBe("01KPQJ1SC");
    expect(uniqueIdPrefix(ids[1]!, ids)).toBe("01KPQJ1SE");
  });

  it("keeps 8 chars when already unique", () => {
    const ids = ["01KPQJ8P50MM4A97R5C3RD3CE1", "01KPP6RV8ABCDEFGH123456789"];

    expect(uniqueIdPrefix(ids[0]!, ids)).toBe("01KPQJ8P");
  });
});
