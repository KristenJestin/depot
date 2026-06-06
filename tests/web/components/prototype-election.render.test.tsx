// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to: _to,
    params: _params,
    ...props
  }: {
    children?: React.ReactNode;
    className?: string;
    to?: unknown;
    params?: unknown;
  } & React.ComponentPropsWithoutRef<"a">) => (
    <a href="#" className={className} {...props}>
      {children}
    </a>
  ),
  createFileRoute: () => () => ({}),
  useNavigate: () => () => undefined,
}));

import { Badge } from "#/web/components/ui/badge";
import {
  electionAffordance,
  electionOfRound,
  isElected,
} from "#/web/routes/prds.$id.prototype.$slug";

/**
 * PRD 0028 / 0030 — round-scoped election (RETENU) in the prototype web preview.
 *
 * `isElected` is the pure decision behind the RETENU badge: a variant is
 * retained when the (round-scoped) `chosenVariantId` matches it. It is distinct
 * from `MAIN` (the agent-chosen per-version primacy hint), so the two can
 * coexist on the same variant. `electionOfRound` resolves the election from the
 * current round's manifest entry.
 */
describe("isElected (PRD 0028)", () => {
  it("is true only for the variant the page elected", () => {
    const page = { chosenVariantId: "var-2" };
    expect(isElected(page, "var-2")).toBe(true);
    expect(isElected(page, "var-1")).toBe(false);
  });

  it("is false when the page has no election", () => {
    const page = { chosenVariantId: null };
    expect(isElected(page, "var-2")).toBe(false);
  });
});

describe("RETENU badge rendering (PRD 0028)", () => {
  it("renders the RETENU badge for the elected variant (distinct from MAIN)", () => {
    const variants = [
      { id: "var-1", isMain: true },
      { id: "var-2", isMain: false },
    ];
    const chosenVariantId = "var-2";
    render(
      <ul>
        {variants.map((v) => (
          <li key={v.id} data-testid={`variant-${v.id}`}>
            {v.isMain ? (
              <Badge variant="neutral" className="text-[8px]">
                MAIN
              </Badge>
            ) : null}
            {isElected({ chosenVariantId }, v.id) ? (
              <Badge variant="success" className="text-[8px]">
                RETENU
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>,
    );

    // The elected variant carries RETENU; the non-elected one does not.
    expect(screen.getByText("RETENU")).toBeInTheDocument();
    expect(screen.getByTestId("variant-var-2")).toHaveTextContent("RETENU");
    expect(screen.getByTestId("variant-var-1")).not.toHaveTextContent("RETENU");
    // MAIN and RETENU are independent: the MAIN variant here is NOT the elected one.
    expect(screen.getByTestId("variant-var-1")).toHaveTextContent("MAIN");
  });

  it("renders no RETENU badge when no variant is elected", () => {
    const variants = [{ id: "var-1", isMain: true }];
    render(
      <ul>
        {variants.map((v) => (
          <li key={v.id}>
            {isElected({ chosenVariantId: null }, v.id) ? (
              <Badge variant="success">RETENU</Badge>
            ) : null}
          </li>
        ))}
      </ul>,
    );
    expect(screen.queryByText("RETENU")).not.toBeInTheDocument();
  });
});

/**
 * Mono-variant refinement (PRD 0028): a page with a single variant is retained
 * by default. `electionAffordance` is the pure three-way decision behind the
 * control next to the VARIANT picker — `"auto"` for a single variant (no button,
 * no green RETENU), `"button"` for a genuine undecided choice (≥ 2 variants),
 * `"elected"` for an explicit election (honoured even on a single variant).
 */
describe("electionAffordance (PRD 0028 — mono-variant)", () => {
  it("is 'auto' for a single variant with no election (retained by default)", () => {
    expect(electionAffordance(1, { chosenVariantId: null }, "var-1")).toBe("auto");
  });

  it("is 'button' for ≥ 2 variants with no election (a real, undecided choice)", () => {
    expect(electionAffordance(2, { chosenVariantId: null }, "var-1")).toBe("button");
    expect(electionAffordance(3, { chosenVariantId: null }, "var-1")).toBe("button");
  });

  it("is 'elected' for the elected variant with ≥ 2 variants", () => {
    expect(electionAffordance(2, { chosenVariantId: "var-2" }, "var-2")).toBe("elected");
  });

  it("honours an explicit election even on a single-variant page (legacy/CLI path)", () => {
    expect(electionAffordance(1, { chosenVariantId: "var-1" }, "var-1")).toBe("elected");
  });

  it("is 'button' for a non-elected variant among ≥ 2 when a sibling is elected", () => {
    expect(electionAffordance(2, { chosenVariantId: "var-2" }, "var-1")).toBe("button");
  });
});

/**
 * Round-scoped election (PRD 0030): `electionOfRound` reads the chosen variant +
 * rationale from a round's manifest entry for a page, so the RETENU badge
 * reflects the round being viewed, not a stale page-level decision.
 */
describe("electionOfRound (PRD 0030)", () => {
  const tree = {
    prototype: { id: "p", slug: "p", description: null, archivedAt: null },
    pages: [],
    rounds: [
      {
        round: { id: "r1", label: "v1", position: 0, summary: null },
        pages: [
          {
            pageId: "page-a",
            pageVersionId: "ver-a",
            position: 0,
            chosenVariantId: "var-1",
            decisionRationale: "v1 pick",
            decidedBy: null,
            decidedAt: null,
          },
        ],
      },
      {
        round: { id: "r2", label: "v2", position: 1, summary: null },
        pages: [
          {
            pageId: "page-a",
            pageVersionId: "ver-a2",
            position: 0,
            chosenVariantId: "var-9",
            decisionRationale: "v2 pick",
            decidedBy: null,
            decidedAt: null,
          },
        ],
      },
    ],
  };

  it("returns the manifest entry's election for the given round", () => {
    expect(electionOfRound(tree, "r1", "page-a")).toEqual({
      chosenVariantId: "var-1",
      decisionRationale: "v1 pick",
    });
    // A different round has its own decision.
    expect(electionOfRound(tree, "r2", "page-a")).toEqual({
      chosenVariantId: "var-9",
      decisionRationale: "v2 pick",
    });
  });

  it("returns nulls for an unknown round or a page not in the manifest", () => {
    expect(electionOfRound(tree, null, "page-a")).toEqual({
      chosenVariantId: null,
      decisionRationale: null,
    });
    expect(electionOfRound(tree, "r1", "page-z")).toEqual({
      chosenVariantId: null,
      decisionRationale: null,
    });
  });
});
