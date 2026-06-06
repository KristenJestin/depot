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

import {
  DroppedPageNotice,
  currentRoundOf,
  droppedSlugsOf,
  pagesOfRound,
  pinnedVersionId,
} from "#/web/routes/prds.$id.prototype.$slug";

/**
 * PRD 0029 — round-driven navigation in the prototype web preview.
 *
 * The pure derivations are exercised directly so the tests stay free of the full
 * route's router + query + iframe boilerplate:
 *   - `currentRoundOf` / `droppedSlugsOf`: which engraved page slugs point at a
 *     page dropped from the current round (max position).
 *   - `pagesOfRound`: the pages a round exposes (manifest membership, manifest
 *     order), which drive the Page selector.
 *   - `pinnedVersionId`: the version a round pins for a page, which drives the
 *     resolved variant (the Version selector is no longer surfaced).
 *   - `DroppedPageNotice`: the dismissable encart shown on a `depot:nav-dropped`
 *     click, which states the page survives in earlier rounds.
 */

type Tree = Parameters<typeof droppedSlugsOf>[0];

function makeTree(): Tree {
  return {
    prototype: { id: "p1", slug: "jobs", description: null, archivedAt: null },
    pages: [
      {
        page: {
          id: "pg-kept",
          slug: "jobs-list",
          title: "Jobs",
          position: 0,
          chosenVariantId: null,
          decisionRationale: null,
          decidedBy: null,
          decidedAt: null,
        },
        versions: [],
      },
      {
        page: {
          id: "pg-dropped",
          slug: "jobs-old",
          title: "Old",
          position: 1,
          chosenVariantId: null,
          decisionRationale: null,
          decidedBy: null,
          decidedAt: null,
        },
        versions: [],
      },
    ],
    rounds: [
      {
        round: { id: "r1", label: "round-1", position: 0, summary: null },
        pages: [
          { pageId: "pg-kept", pageVersionId: "v-kept-1", position: 0 },
          { pageId: "pg-dropped", pageVersionId: "v-old-1", position: 1 },
        ],
      },
      {
        round: { id: "r2", label: "round-2", position: 1, summary: null },
        pages: [{ pageId: "pg-kept", pageVersionId: "v-kept-1", position: 0 }],
      },
    ],
  };
}

describe("dropped-page derivation (PRD 0029)", () => {
  it("currentRoundOf picks the round with the maximum position", () => {
    const tree = makeTree();
    expect(currentRoundOf(tree.rounds)?.round.id).toBe("r2");
  });

  it("currentRoundOf returns null with no round", () => {
    expect(currentRoundOf([])).toBeNull();
  });

  it("droppedSlugsOf returns slugs absent from the current round manifest", () => {
    const dropped = droppedSlugsOf(makeTree());
    expect([...dropped]).toEqual(["jobs-old"]);
    expect(dropped.has("jobs-list")).toBe(false);
  });

  it("droppedSlugsOf is empty when there is no round (defensive)", () => {
    const tree = makeTree();
    tree.rounds = [];
    expect(droppedSlugsOf(tree).size).toBe(0);
  });
});

describe("pagesOfRound (PRD 0029)", () => {
  it("returns only the round's manifest pages, ordered by manifest position", () => {
    const tree = makeTree();
    // Reorder r1's manifest so the dropped page is listed before the kept one;
    // the result must follow manifest position, not the page's own position.
    tree.rounds[0]!.pages = [
      { pageId: "pg-dropped", pageVersionId: "v-old-1", position: 0 },
      { pageId: "pg-kept", pageVersionId: "v-kept-1", position: 1 },
    ];
    const r1Pages = pagesOfRound(tree, "r1");
    expect(r1Pages.map((p) => p.page.id)).toEqual(["pg-dropped", "pg-kept"]);
  });

  it("excludes pages dropped from the selected round", () => {
    const tree = makeTree();
    const r2Pages = pagesOfRound(tree, "r2");
    expect(r2Pages.map((p) => p.page.id)).toEqual(["pg-kept"]);
  });

  it("skips manifest entries that have no matching tree page (defensive)", () => {
    const tree = makeTree();
    tree.rounds[1]!.pages = [
      { pageId: "pg-kept", pageVersionId: "v-kept-1", position: 0 },
      { pageId: "pg-ghost", pageVersionId: "v-ghost", position: 1 },
    ];
    expect(pagesOfRound(tree, "r2").map((p) => p.page.id)).toEqual(["pg-kept"]);
  });

  it("returns an empty list for an unknown round or no round", () => {
    const tree = makeTree();
    expect(pagesOfRound(tree, "nope")).toEqual([]);
    expect(pagesOfRound(tree, null)).toEqual([]);
  });
});

describe("pinnedVersionId (PRD 0029)", () => {
  it("returns the version the round pins for a page", () => {
    const tree = makeTree();
    expect(pinnedVersionId(tree, "r1", "pg-kept")).toBe("v-kept-1");
    expect(pinnedVersionId(tree, "r1", "pg-dropped")).toBe("v-old-1");
  });

  it("returns null for a page dropped from / absent in the round", () => {
    const tree = makeTree();
    expect(pinnedVersionId(tree, "r2", "pg-dropped")).toBeNull();
  });

  it("returns null for an unknown round or no round", () => {
    const tree = makeTree();
    expect(pinnedVersionId(tree, "nope", "pg-kept")).toBeNull();
    expect(pinnedVersionId(tree, null, "pg-kept")).toBeNull();
  });
});

describe("DroppedPageNotice (PRD 0029)", () => {
  it("names the page and round and says it survives in earlier rounds", () => {
    render(<DroppedPageNotice page="jobs-old" roundLabel="round-2" onDismiss={() => {}} />);
    const notice = screen.getByTestId("dropped-page-notice");
    expect(notice).toHaveTextContent("jobs-old");
    expect(notice).toHaveTextContent("round-2");
    expect(notice).toHaveTextContent("rounds antérieurs");
  });

  it("is dismissable via its close button", () => {
    const onDismiss = vi.fn<() => void>();
    render(<DroppedPageNotice page="jobs-old" roundLabel="round-2" onDismiss={onDismiss} />);
    screen.getByRole("button", { name: "Fermer" }).click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
