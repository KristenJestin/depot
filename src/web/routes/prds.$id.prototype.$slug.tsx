import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  EyeOffIcon,
  Link2Icon,
  MapPinIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Badge } from "#/web/components/ui/badge";
import { Button } from "#/web/components/ui/button";
import { CollapseChevron } from "#/web/components/ui/collapse-chevron";
import { CollapsedRail } from "#/web/components/ui/collapsed-rail";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "#/web/components/ui/collapsible";
import { ConfirmDialog } from "#/web/components/ui/confirm-dialog";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";
import { PageShell, PageTopBar } from "#/web/components/page-shell";
import { PinPopup, type PinPopupState } from "#/web/components/prototype-pin-popup";
import { Textarea } from "#/web/components/ui/textarea";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { cn } from "#/web/lib/utils";
import { prdsQuery } from "#/web/lib/queries";

/**
 * `/prds/$id/prototype/$slug` — the prototype workspace (PRD 0025 / T1).
 *
 * Strict invariants:
 *   - Read-only on every structural mutation (no `+ page`, `+ variant`,
 *     `set-main`, `archive`, …). The only writes go through the feedback
 *     pipeline (create / resolve / ignore — and even resolve/ignore happen
 *     via CLI; the UI only creates).
 *   - Navigation is round-driven (PRD 0029): the toolbar exposes
 *     PROTOTYPE → ROUND → PAGE → VARIANT. The round pins one version per page,
 *     so the human never picks a version; the page swap just changes which
 *     variant's `/raw` URL feeds the iframe (all local, no extra fetch).
 *   - Feedback dropdown follows the base-ui `Select` pattern so the chevron
 *     + popup match the rest of the app.
 *   - Cmd/Ctrl+Enter in the compose textarea submits the feedback.
 */

type Variant = {
  id: string;
  label: string;
  title: string;
  isMain: boolean;
  position: number;
  pageVersionId: string;
};

type Version = {
  id: string;
  label: string;
  summary: string | null;
  archivedAt: string | null;
  variants: Variant[];
  feedbacks: Feedback[];
};

type Page = {
  page: { id: string; slug: string; title: string; position: number };
  versions: Array<{
    version:
      | (Omit<Version, "variants" | "feedbacks"> & Record<string, never>)
      | Record<string, never>;
    variants: Variant[];
    feedbacks: Feedback[];
  }>;
};

type Feedback = {
  id: string;
  variantId: string;
  text: string;
  selectorCss: string | null;
  status: "open" | "ignored";
  resolutionNote: string | null;
  resolutionViaVariantId: string | null;
  resolvedAt: string | null;
  ignoredReason: string | null;
  ignoredAt: string | null;
  createdAt: string;
};

type Round = {
  round: { id: string; label: string; position: number; summary: string | null };
  pages: Array<{
    pageId: string;
    pageVersionId: string;
    position: number;
    // Election (PRD 0030): round-scoped — the variant chosen for this page IN
    // this round, with its arbitration record. Null until elected (or after a
    // pin advance reset it). Optional in the type so older test fixtures (that
    // only assert manifest membership) need not spell them out; the server
    // always serves them.
    chosenVariantId?: string | null;
    decisionRationale?: string | null;
    decidedBy?: string | null;
    decidedAt?: string | null;
  }>;
};

/**
 * The page row as served by the tree. The legacy per-page election columns
 * (`chosenVariantId`, …) are still present additively, but the election is now
 * round-scoped (PRD 0030): the source of truth is the current round's manifest
 * entry, read via `electionOfRound`. The page-level columns are no longer used
 * to drive the RETENU badge.
 */
type TreePage = {
  id: string;
  slug: string;
  title: string;
  position: number;
  chosenVariantId: string | null;
  decisionRationale: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

/**
 * The round-scoped election for a page (PRD 0030): the manifest entry's chosen
 * variant + rationale in the given round. Returns nulls when the round is
 * unknown or the page is not in its manifest. Pure so the RETENU/affordance
 * decisions stay unit-testable.
 */
export function electionOfRound(
  tree: TreeResponse,
  roundId: string | null,
  pageId: string,
): { chosenVariantId: string | null; decisionRationale: string | null } {
  if (roundId === null) return { chosenVariantId: null, decisionRationale: null };
  const round = tree.rounds.find((r) => r.round.id === roundId);
  const entry = round?.pages.find((e) => e.pageId === pageId);
  return {
    chosenVariantId: entry?.chosenVariantId ?? null,
    decisionRationale: entry?.decisionRationale ?? null,
  };
}

type TreeResponse = {
  prototype: { id: string; slug: string; description: string | null; archivedAt: string | null };
  pages: Array<{
    page: TreePage;
    versions: Array<{
      version: { id: string; label: string; summary: string | null; archivedAt: string | null };
      variants: Variant[];
      feedbacks: Feedback[];
    }>;
  }>;
  rounds: Round[];
};

/**
 * Whether a given variant is the elected one (PRD 0028 / 0030). The election is
 * round-scoped: callers pass the current round's `{ chosenVariantId }` (via
 * `electionOfRound`). Pure so the RETENU badge decision is unit-testable without
 * the full route.
 */
export function isElected(
  election: { chosenVariantId: string | null },
  variantId: string,
): boolean {
  return election.chosenVariantId !== null && election.chosenVariantId === variantId;
}

/**
 * The affordance to show next to the displayed variant for the election
 * decision (PRD 0028, mono-variant refinement). A page only offers a *real*
 * choice when its shown version carries ≥ 2 variants:
 *
 *   - `"elected"` — this variant carries an explicit election (`RETENU` + a way
 *     to clear it). Honoured even on a single-variant page (legacy / CLI path).
 *   - `"auto"` — a single-variant page with no explicit election: retained by
 *     default, nothing to choose. Shown as a muted "seule variante" indicator,
 *     never the green `RETENU` badge.
 *   - `"button"` — a genuine, undecided choice (≥ 2 variants, no election): the
 *     "Retenir cette variante" button.
 *
 * Pure so the three-way decision is unit-testable without the full route.
 */
export function electionAffordance(
  variantsCount: number,
  election: { chosenVariantId: string | null },
  variantId: string,
): "button" | "elected" | "auto" {
  if (isElected(election, variantId)) return "elected";
  if (variantsCount <= 1) return "auto";
  return "button";
}

/**
 * The current round is the one with the maximum `position` (the domain keeps
 * rounds sorted by position ascending, so the last entry wins). Returns `null`
 * defensively when the prototype has no round.
 */
export function currentRoundOf(rounds: Round[]): Round | null {
  if (rounds.length === 0) return null;
  return rounds.reduce((max, r) => (r.round.position > max.round.position ? r : max), rounds[0]!);
}

/**
 * Slugs of pages that exist in the tree but are absent from the current round's
 * manifest — i.e. dropped from the round. Membership is row presence in the
 * manifest, so a page whose `id` is not pinned by the current round is dropped.
 * With no round, nothing is dropped.
 */
export function droppedSlugsOf(tree: TreeResponse): Set<string> {
  const current = currentRoundOf(tree.rounds);
  if (!current) return new Set();
  const pinned = new Set(current.pages.map((e) => e.pageId));
  const dropped = new Set<string>();
  for (const entry of tree.pages) {
    if (!pinned.has(entry.page.id)) dropped.add(entry.page.slug);
  }
  return dropped;
}

type RoundPage = TreeResponse["pages"][number] & { manifestPosition: number };

/**
 * The pages a round exposes: the tree pages whose `id` appears in the round's
 * manifest, ordered by the manifest's `position` (not the page's own position).
 * A manifest entry with no matching tree page is skipped defensively. An unknown
 * `roundId` (or no round at all) yields an empty list.
 */
export function pagesOfRound(tree: TreeResponse, roundId: string | null): RoundPage[] {
  if (roundId === null) return [];
  const round = tree.rounds.find((r) => r.round.id === roundId);
  if (!round) return [];
  const byId = new Map(tree.pages.map((p) => [p.page.id, p]));
  const result: RoundPage[] = [];
  for (const entry of [...round.pages].sort((a, b) => a.position - b.position)) {
    const page = byId.get(entry.pageId);
    if (page) result.push({ ...page, manifestPosition: entry.position });
  }
  return result;
}

/**
 * The version a round pins for a given page — the manifest entry's
 * `pageVersionId`. Returns `null` when the round is unknown or the page is not
 * part of the round's manifest (i.e. dropped from / never in this round).
 */
export function pinnedVersionId(
  tree: TreeResponse,
  roundId: string | null,
  pageId: string,
): string | null {
  if (roundId === null) return null;
  const round = tree.rounds.find((r) => r.round.id === roundId);
  if (!round) return null;
  return round.pages.find((e) => e.pageId === pageId)?.pageVersionId ?? null;
}

/**
 * Non-blocking, dismissable notice shown when the viewer clicks an engraved
 * link to a page dropped from the current round. The shim intercepts the click
 * (no navigation happens); this only informs that the page still lives in the
 * earlier rounds. Overlays the top of the preview without stealing focus.
 */
export function DroppedPageNotice({
  page,
  roundLabel,
  onDismiss,
}: {
  page: string;
  roundLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="dropped-page-notice"
      className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 border-b border-warning/20 bg-warning-soft px-3 py-2 text-xs text-warning-foreground shadow-sm"
    >
      <span className="inline-flex items-start gap-1.5">
        <EyeOffIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          La page <span className="font-medium">“{page}”</span> a été retirée
          {roundLabel ? ` du round “${roundLabel}”` : " de ce round"}. Elle existe toujours dans les
          rounds antérieurs.
        </span>
      </span>
      <button
        type="button"
        aria-label="Fermer"
        title="Fermer"
        className="shrink-0 rounded p-0.5 transition-colors hover:bg-warning/15"
        onClick={onDismiss}
      >
        <XIcon className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

type FeedbackMode = "off" | "pin";

const PANEL_OPEN_STORAGE_KEY = "depot:prototype-panel-open";
const NAV_HIGHLIGHT_STORAGE_KEY = "depot:prototype-nav-highlight";
const VIEWPORT_STORAGE_KEY = "depot:prototype-viewport";

/**
 * Iframe sizing presets, à la Storybook / Figma. `responsive` lets the iframe
 * stretch to the wrapper. The numeric presets cap the iframe at a fixed pixel
 * width centered in the wrapper, with the surrounding bg-muted/40 acting as
 * the implied "device chrome". A horizontal scrollbar kicks in on the wrapper
 * if the preset is wider than the visible area.
 */
type ViewportPresetKey = "responsive" | "desktop" | "laptop" | "tablet" | "mobile";

const VIEWPORT_PRESETS: ReadonlyArray<{
  key: ViewportPresetKey;
  label: string;
  width: number | null;
}> = [
  { key: "responsive", label: "Responsive", width: null },
  { key: "desktop", label: "Desktop", width: 1440 },
  { key: "laptop", label: "Laptop", width: 1280 },
  { key: "tablet", label: "Tablet", width: 768 },
  { key: "mobile", label: "Mobile", width: 375 },
];

export const Route = createFileRoute("/prds/$id/prototype/$slug")({
  component: PrototypeWorkspaceRoute,
});

function PrototypeWorkspaceRoute() {
  const { id, slug } = Route.useParams();
  return <PrototypeWorkspace prdRevisionId={id} prototypeSlug={slug} />;
}

function PrototypeWorkspace({
  prdRevisionId,
  prototypeSlug,
}: {
  prdRevisionId: string;
  prototypeSlug: string;
}) {
  const listQ = useQuery({
    queryKey: ["prototypes", "list", prdRevisionId],
    queryFn: async () => {
      const res = await fetch(`/api/prd-revisions/${prdRevisionId}/prototypes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as {
        items: Array<{
          id: string;
          slug: string;
          description: string | null;
          archivedAt: string | null;
        }>;
      };
    },
  });

  const found = listQ.data?.items.find((p) => p.slug === prototypeSlug);
  const prototypeId = found?.id ?? null;

  // Surface the owning PRD by *title*, not just a truncated revision id, so a
  // viewer reached via a restored/bookmarked URL can't be mistaken for the PRD
  // the user thinks they are on (dogfooding friction: "I lost everything!").
  const prdTitle = useQuery(prdsQuery.detail.options(prdRevisionId)).data?.prd.title ?? null;
  const prdLabel = prdTitle ?? `Rev. ${prdRevisionId.slice(0, 8)}…`;

  const treeQ = useQuery({
    queryKey: ["prototypes", "tree", prototypeId],
    enabled: prototypeId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/prototypes/${prototypeId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as TreeResponse;
    },
  });

  if (listQ.isPending) {
    return (
      <PageShell>
        <PageTopBar>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>Loading prototype...</BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageTopBar>
      </PageShell>
    );
  }

  if (listQ.isError) {
    return (
      <PageShell>
        <PageTopBar>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>Prototype load failed</BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageTopBar>
        <div className="p-6 text-sm text-destructive">
          Could not load prototypes: {listQ.error.message}
        </div>
      </PageShell>
    );
  }

  if (!found) {
    return (
      <PageShell>
        <PageTopBar>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <Link to="/" className="hover:text-foreground">
                  PRDs
                </Link>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <Link
                  to="/prds/$id"
                  params={{ id: prdRevisionId }}
                  className="hover:text-foreground"
                >
                  {prdLabel}
                </Link>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>prototype/{prototypeSlug}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageTopBar>
        <div className="p-6 text-sm text-muted-foreground">
          No prototype with slug “{prototypeSlug}” on {prdTitle ? `PRD “${prdTitle}”` : "this PRD"}.
        </div>
      </PageShell>
    );
  }

  if (treeQ.isError) {
    return (
      <PageShell>
        <PageTopBar>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>Prototype load failed</BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageTopBar>
        <div className="p-6 text-sm text-destructive">
          Could not load prototype tree: {treeQ.error.message}
        </div>
      </PageShell>
    );
  }

  if (!treeQ.data) {
    return (
      <PageShell>
        <PageTopBar>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>Loading…</BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageTopBar>
      </PageShell>
    );
  }

  const visiblePrototypes = (listQ.data?.items ?? []).filter((p) => p.archivedAt === null);

  return (
    <PrototypeWorkspaceContent
      prdRevisionId={prdRevisionId}
      prdLabel={prdLabel}
      tree={treeQ.data}
      siblings={visiblePrototypes}
    />
  );
}

function PrototypeWorkspaceContent({
  prdRevisionId,
  prdLabel,
  tree,
  siblings,
}: {
  prdRevisionId: string;
  prdLabel: string;
  tree: TreeResponse;
  siblings: Array<{ id: string; slug: string; description: string | null }>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pages = tree.pages;

  const [roundId, setRoundId] = useState<string | null>(
    () => currentRoundOf(tree.rounds)?.round.id ?? null,
  );
  const [pageId, setPageId] = useState<string | null>(null);
  const [variantIdx, setVariantIdx] = useState<Record<string, number>>({});
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>("off");
  const [composeText, setComposeText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinPopup, setPinPopup] = useState<PinPopupState | null>(null);
  const [feedbackToDelete, setFeedbackToDelete] = useState<Feedback | null>(null);
  const [droppedNotice, setDroppedNotice] = useState<{ page: string; roundLabel: string } | null>(
    null,
  );
  const [panelOpen, setPanelOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(PANEL_OPEN_STORAGE_KEY);
    return stored === null ? true : stored === "1";
  });
  const [navHighlight, setNavHighlight] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(NAV_HIGHLIGHT_STORAGE_KEY) === "1";
  });
  const [viewport, setViewport] = useState<ViewportPresetKey>(() => {
    if (typeof window === "undefined") return "responsive";
    const stored = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);
    const known = VIEWPORT_PRESETS.find((p) => p.key === stored);
    return known?.key ?? "responsive";
  });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PANEL_OPEN_STORAGE_KEY, panelOpen ? "1" : "0");
  }, [panelOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEWPORT_STORAGE_KEY, viewport);
  }, [viewport]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NAV_HIGHLIGHT_STORAGE_KEY, navHighlight ? "1" : "0");
  }, [navHighlight]);

  const currentRound = useMemo(() => currentRoundOf(tree.rounds), [tree.rounds]);
  const droppedSlugs = useMemo(() => droppedSlugsOf(tree), [tree]);

  const selectedRound = useMemo(
    () => tree.rounds.find((r) => r.round.id === roundId) ?? null,
    [tree.rounds, roundId],
  );
  const roundPages = useMemo(() => pagesOfRound(tree, roundId), [tree, roundId]);

  // The selected page is tracked by id so it survives a round switch; it falls
  // back to the round's first page whenever the current id is not in the round.
  const currentPage = roundPages.find((p) => p.page.id === pageId) ?? roundPages[0] ?? pages[0];
  const currentPageId = currentPage?.page.id ?? null;

  // The election is round-scoped (PRD 0030): read it from the selected round's
  // manifest entry, not the page. Elect/unelect still write the current round
  // (the API always targets `getCurrentRound`).
  const currentElection = electionOfRound(tree, roundId, currentPageId ?? "");
  const electedPageIds = useMemo(() => {
    const round = tree.rounds.find((r) => r.round.id === roundId);
    return new Set(
      (round?.pages ?? []).filter((e) => e.chosenVariantId !== null).map((e) => e.pageId),
    );
  }, [tree.rounds, roundId]);

  // The round pins exactly one version per page (its manifest entry). Resolve it
  // in the tree to reach the variants; an out-of-round page yields no pin.
  const pinnedId = pinnedVersionId(tree, roundId, currentPageId ?? "");
  const currentVersionEntry =
    currentPage?.versions.find((v) => v.version.id === pinnedId) ?? undefined;
  const currentVariants = currentVersionEntry?.variants ?? [];
  const currentVariantIdx =
    variantIdx[currentVersionEntry?.version.id ?? ""] ??
    Math.max(
      0,
      currentVariants.findIndex((v) => v.isMain),
    );
  const currentVariant = currentVariants[currentVariantIdx];

  // Snap the selected page back onto the round when a round switch leaves it
  // pointing at a page that round does not expose.
  useEffect(() => {
    if (currentPageId !== null && pageId !== currentPageId) setPageId(currentPageId);
  }, [currentPageId, pageId]);

  // Reset the variant index when the version changes.
  useEffect(() => {
    if (!currentVersionEntry) return;
    setVariantIdx((map) => {
      if (map[currentVersionEntry.version.id] !== undefined) return map;
      const mainIdx = Math.max(
        0,
        currentVariants.findIndex((v) => v.isMain),
      );
      return { ...map, [currentVersionEntry.version.id]: mainIdx };
    });
  }, [currentVersionEntry, currentVariants]);

  // Send the feedback mode to the iframe on every change.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "depot:set-feedback-mode", mode: feedbackMode }, "*");
  }, [feedbackMode, currentVariant?.id]);

  // Push the nav-highlight setting to the iframe whenever it changes or the
  // variant swaps (a fresh iframe loses the previous body class).
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "depot:set-nav-highlight", enabled: navHighlight }, "*");
  }, [navHighlight, currentVariant?.id]);

  // Tell the iframe which engraved page links point at a page dropped from the
  // current round so the shim can grey them out and intercept their clicks.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "depot:mark-dropped-pages", slugs: [...droppedSlugs] }, "*");
  }, [droppedSlugs, currentVariant?.id]);

  function postHighlightSelector(selector: string): void {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "depot:highlight-selector", selector }, "*");
  }
  function postClearHighlight(): void {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "depot:clear-highlight" }, "*");
  }

  // Listen for the iframe's postMessage events.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const data = (e.data ?? {}) as {
        type?: string;
        selector?: string;
        page?: string;
        variant?: string | null;
        x?: number;
        y?: number;
      };
      if (data.type === "depot:feedback-pin" && data.selector) {
        setPinPopup({
          selector: data.selector,
          x: typeof data.x === "number" ? data.x : 0,
          y: typeof data.y === "number" ? data.y : 0,
        });
        setFeedbackMode("off");
      }
      if (data.type === "depot:nav" && data.page) {
        const target = roundPages.find((p) => p.page.slug === data.page);
        if (target) {
          setDroppedNotice(null);
          setPageId(target.page.id);
        } else {
          setDroppedNotice({
            page: data.page,
            roundLabel: selectedRound?.round.label ?? "",
          });
        }
      }
      if (data.type === "depot:nav-dropped" && data.page) {
        setDroppedNotice({
          page: data.page,
          roundLabel: selectedRound?.round.label ?? "",
        });
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [roundPages, selectedRound]);

  const createFeedback = useMutation({
    mutationFn: async ({
      variantId,
      text,
      selectorCss,
    }: {
      variantId: string;
      text: string;
      selectorCss: string | null;
    }) => {
      const res = await fetch(`/api/prototype-variants/${variantId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, selectorCss }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      setError(null);
      setComposeText("");
      void queryClient.invalidateQueries({ queryKey: ["prototypes", "tree"] });
    },
  });

  async function postFeedback(
    variantId: string,
    text: string,
    selectorCss: string | null = null,
  ): Promise<void> {
    await createFeedback.mutateAsync({ variantId, text, selectorCss });
  }

  const deleteFeedback = useMutation({
    mutationFn: async (fbId: string) => {
      const res = await fetch(`/api/feedbacks/${fbId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["prototypes", "tree"] });
    },
  });

  // Election (PRD 0028). Electing also flips the `prd ready` design-lock gate,
  // so invalidate the PRD detail queries too — same fan-out the priority badge
  // uses — so a readiness indicator elsewhere refreshes.
  const electVariant = useMutation({
    mutationFn: async ({ variantId, rationale }: { variantId: string; rationale: string }) => {
      const res = await fetch(`/api/prototype-variants/${variantId}/elect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rationale }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["prototypes", "tree"] });
      void queryClient.invalidateQueries({ queryKey: ["prds"] });
    },
  });

  const clearElection = useMutation({
    mutationFn: async (pageIdToClear: string) => {
      const res = await fetch(`/api/prototype-pages/${pageIdToClear}/election`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["prototypes", "tree"] });
      void queryClient.invalidateQueries({ queryKey: ["prds"] });
    },
  });

  const electionPending = electVariant.isPending || clearElection.isPending;

  const openFeedbacks = currentVersionEntry?.feedbacks.filter((f) => f.status === "open") ?? [];

  const latestActiveVersionId = useMemo(() => {
    const active = (currentPage?.versions ?? []).filter((v) => v.version.archivedAt === null);
    return active.at(-1)?.version.id ?? null;
  }, [currentPage]);
  const isOnLatestVersion =
    currentVersionEntry !== undefined &&
    latestActiveVersionId !== null &&
    currentVersionEntry.version.id === latestActiveVersionId;

  const allHistory = useMemo(() => {
    const collected: Array<{ page: Page["page"]; version: Version; feedback: Feedback }> = [];
    for (const pageEntry of pages) {
      const activeVersions = pageEntry.versions.filter((v) => v.version.archivedAt === null);
      const latestActiveId = activeVersions.at(-1)?.version.id;
      for (const versionEntry of pageEntry.versions) {
        const isStale = versionEntry.version.id !== latestActiveId;
        for (const fb of versionEntry.feedbacks) {
          if (fb.status === "ignored" || (isStale && fb.status === "open")) {
            collected.push({
              // TS appeasement: we don't use the inner Page typedef here.
              page: pageEntry.page,
              version: versionEntry as unknown as Version,
              feedback: fb,
            });
          }
        }
      }
    }
    return collected;
  }, [pages]);

  const ignoredCount = allHistory.filter((h) => h.feedback.status === "ignored").length;
  const resolvedCount = allHistory.length - ignoredCount;

  return (
    <PageShell>
      <PageTopBar>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link to="/" className="hover:text-foreground">
                PRDs
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <Link to="/prds/$id" params={{ id: prdRevisionId }} className="hover:text-foreground">
                {prdLabel}
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>prototype/{tree.prototype.slug}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>

      <SubToolbar
        prdRevisionId={prdRevisionId}
        prototypeSlug={tree.prototype.slug}
        siblings={siblings}
        onSiblingChange={(slug) =>
          navigate({
            to: "/prds/$id/prototype/$slug",
            params: { id: prdRevisionId, slug },
          })
        }
        rounds={tree.rounds}
        roundId={selectedRound?.round.id ?? null}
        currentRoundId={currentRound?.round.id ?? null}
        onRoundId={(id) => {
          setDroppedNotice(null);
          setRoundId(id);
          setPageId(null);
        }}
        roundPages={roundPages}
        electedPageIds={electedPageIds}
        pageId={currentPageId}
        onPageId={(id) => {
          setDroppedNotice(null);
          setPageId(id);
        }}
        variants={currentVariants}
        variantIdx={currentVariantIdx}
        onVariantIdx={(idx) =>
          currentVersionEntry &&
          setVariantIdx((m) => ({ ...m, [currentVersionEntry.version.id]: idx }))
        }
        chosenVariantId={currentElection.chosenVariantId}
        decisionRationale={currentElection.decisionRationale}
        electionPending={electionPending}
        onElect={(variantId, rationale) => void electVariant.mutateAsync({ variantId, rationale })}
        onUnelect={() => currentPageId !== null && void clearElection.mutateAsync(currentPageId)}
        feedbackMode={feedbackMode}
        setFeedbackMode={setFeedbackMode}
        navHighlight={navHighlight}
        onNavHighlightToggle={() => setNavHighlight((o) => !o)}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className="relative flex min-w-0 flex-1 flex-col bg-muted/40 p-4"
          data-testid="iframe-outer"
        >
          <ViewportToolbar
            viewport={viewport}
            onViewportChange={setViewport}
            wrapperRef={iframeWrapperRef}
          />
          <div className="relative min-h-0 flex-1 overflow-auto">
            <div
              ref={iframeWrapperRef}
              className="relative mx-auto h-full overflow-hidden rounded-md border border-card-border bg-white shadow-md transition-[width] duration-200 ease-out"
              style={{
                width:
                  VIEWPORT_PRESETS.find((p) => p.key === viewport)?.width !== null
                    ? `${VIEWPORT_PRESETS.find((p) => p.key === viewport)?.width}px`
                    : "100%",
                maxWidth:
                  VIEWPORT_PRESETS.find((p) => p.key === viewport)?.width !== null
                    ? undefined
                    : "100%",
              }}
              data-testid="iframe-wrapper"
            >
              {feedbackMode === "pin" ? (
                <div
                  role="status"
                  className="pointer-events-auto absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 border-b border-card-border bg-card/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <MapPinIcon className="size-3.5 text-primary" aria-hidden />
                    <span>Mode pin — clique un élément pour épingler.</span>
                  </span>
                  <button
                    className="text-xs underline hover:text-primary"
                    onClick={() => setFeedbackMode("off")}
                    type="button"
                  >
                    désactiver
                  </button>
                </div>
              ) : null}
              {droppedNotice ? (
                <DroppedPageNotice
                  page={droppedNotice.page}
                  roundLabel={droppedNotice.roundLabel}
                  onDismiss={() => setDroppedNotice(null)}
                />
              ) : null}
              {currentVariant ? (
                <iframe
                  ref={iframeRef}
                  key={currentVariant.id}
                  title={`Variant ${currentVariant.label}`}
                  src={`/api/prototype-variants/${currentVariant.id}/raw`}
                  sandbox="allow-scripts"
                  className="h-full w-full border-0"
                  onLoad={() => {
                    const win = iframeRef.current?.contentWindow;
                    if (!win) return;
                    win.postMessage({ type: "depot:set-feedback-mode", mode: feedbackMode }, "*");
                    win.postMessage(
                      { type: "depot:set-nav-highlight", enabled: navHighlight },
                      "*",
                    );
                    win.postMessage(
                      { type: "depot:mark-dropped-pages", slugs: [...droppedSlugs] },
                      "*",
                    );
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No variant.
                </div>
              )}
              {pinPopup && currentVariant ? (
                <PinPopup
                  pin={pinPopup}
                  wrapperRef={iframeWrapperRef}
                  pending={createFeedback.isPending}
                  onCancel={() => setPinPopup(null)}
                  onSubmit={async (text) => {
                    await postFeedback(currentVariant.id, text, pinPopup.selector);
                    setPinPopup(null);
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>

        {!panelOpen ? (
          <CollapsedRail
            side="right"
            title="Feedback"
            badge={
              openFeedbacks.length > 0 ? (
                <Badge variant="neutral" className="text-[9px]">
                  {openFeedbacks.length}
                </Badge>
              ) : null
            }
            onOpen={() => setPanelOpen(true)}
          />
        ) : null}

        <div
          aria-hidden={!panelOpen}
          inert={!panelOpen ? true : undefined}
          className={cn(
            "flex shrink-0 flex-col overflow-hidden bg-card transition-[width,opacity,border-color] duration-200 ease-out",
            panelOpen
              ? "w-full border-t border-card-border opacity-100 md:w-80 md:border-l md:border-t-0"
              : "w-0 border-transparent opacity-0 pointer-events-none md:w-0",
          )}
        >
          <aside className="flex h-full w-full flex-col md:w-80" data-testid="feedback-panel">
            <header className="flex items-center justify-between border-b border-card-border px-3 py-2">
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label="Rétracter le panneau feedback"
                className="group flex flex-1 items-center gap-1.5 text-left text-xs font-medium transition-colors hover:text-primary"
              >
                <ChevronRightIcon
                  className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:text-primary"
                  aria-hidden
                />
                <span>
                  Feedbacks · {currentPage?.page.slug}/{currentVersionEntry?.version.label}
                </span>
              </button>
              <Badge variant="neutral">{openFeedbacks.length} open</Badge>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs">
              {openFeedbacks.length === 0 ? (
                <div className="text-muted-foreground">No open feedback on this version.</div>
              ) : (
                <ul className="space-y-2">
                  {openFeedbacks.map((fb) => {
                    const v = currentVariants.find((vv) => vv.id === fb.variantId);
                    const pinned = fb.selectorCss !== null;
                    const canDelete = isOnLatestVersion;
                    return (
                      <li
                        key={fb.id}
                        className={cn(
                          "group rounded border border-card-border bg-card p-2",
                          pinned && "hover:border-primary/60",
                        )}
                        onMouseEnter={
                          pinned ? () => postHighlightSelector(fb.selectorCss!) : undefined
                        }
                        onMouseLeave={pinned ? () => postClearHighlight() : undefined}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] text-muted-foreground">
                            {pinned ? (
                              <span className="inline-flex items-center gap-0.5 font-medium text-primary">
                                <MapPinIcon className="size-2.5" aria-hidden />
                                pin
                              </span>
                            ) : (
                              <span className="italic">global</span>
                            )}
                            {v ? <span>· {v.label}</span> : null}
                          </div>
                          {canDelete ? (
                            <button
                              type="button"
                              aria-label="Supprimer ce feedback"
                              title="Supprimer ce feedback"
                              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                              disabled={deleteFeedback.isPending}
                              onClick={() => setFeedbackToDelete(fb)}
                            >
                              <Trash2Icon className="size-3.5" aria-hidden />
                            </button>
                          ) : null}
                        </div>
                        <div>{fb.text}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <CollapsibleRoot
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              className="shrink-0 border-t border-card-border px-3 py-2 text-xs"
            >
              <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 select-none text-left">
                <CollapseChevron direction="right" size="sm" />
                <span>
                  Historique · {resolvedCount} résolus · {ignoredCount} ignorés
                </span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="mt-2 max-h-[180px] overflow-y-auto">
                  {allHistory.length === 0 ? (
                    <div className="text-muted-foreground">No history yet.</div>
                  ) : (
                    <ul className="space-y-2">
                      {allHistory.map(({ page, version, feedback }) => (
                        <li key={feedback.id} className="rounded border border-card-border p-2">
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span>
                              {page.slug}/{version.label}
                            </span>
                            {feedback.selectorCss ? (
                              <span className="inline-flex items-center gap-0.5 font-medium text-primary/80">
                                <MapPinIcon className="size-2.5" aria-hidden />
                                pin
                              </span>
                            ) : (
                              <span className="italic">· global</span>
                            )}
                          </div>
                          <div>{feedback.text}</div>
                          {feedback.status === "ignored" ? (
                            <div className="mt-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              ✗ Ignoré · {feedback.ignoredReason}
                            </div>
                          ) : (
                            <div className="mt-1 rounded bg-primary-soft px-1.5 py-0.5 text-[10px]">
                              💬 Agent · résolu
                              {feedback.resolutionNote ? ` · ${feedback.resolutionNote}` : ""}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CollapsiblePanel>
            </CollapsibleRoot>

            <ComposeForm
              currentVariantId={currentVariant?.id ?? null}
              text={composeText}
              setText={setComposeText}
              onSubmit={async (text) => {
                if (!currentVariant) return;
                await postFeedback(currentVariant.id, text, null);
              }}
              error={error}
              pending={createFeedback.isPending}
            />
          </aside>
        </div>
      </div>

      <footer className="border-t border-card-border bg-sidebar px-3 py-2 text-xs text-muted-foreground">
        <span>
          {pages.length} pages · {pages.reduce((acc, p) => acc + p.versions.length, 0)} versions ·{" "}
          {pages.reduce((acc, p) => acc + p.versions.reduce((a, v) => a + v.variants.length, 0), 0)}{" "}
          variantes · {openFeedbacks.length} feedbacks ouverts sur la version courante
        </span>
        <span className="italic"> — CRUD via CLI / sub-agent (chat)</span>
      </footer>

      <ConfirmDialog
        open={feedbackToDelete !== null}
        onOpenChange={(o) => {
          if (!o) setFeedbackToDelete(null);
        }}
        title="Supprimer ce feedback ?"
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        loading={deleteFeedback.isPending}
        onConfirm={async () => {
          if (!feedbackToDelete) return;
          await deleteFeedback.mutateAsync(feedbackToDelete.id);
          setFeedbackToDelete(null);
        }}
      />
    </PageShell>
  );
}

function SubToolbar({
  prdRevisionId,
  prototypeSlug,
  siblings,
  onSiblingChange,
  rounds,
  roundId,
  currentRoundId,
  onRoundId,
  roundPages,
  electedPageIds,
  pageId,
  onPageId,
  variants,
  variantIdx,
  onVariantIdx,
  chosenVariantId,
  decisionRationale,
  electionPending,
  onElect,
  onUnelect,
  feedbackMode,
  setFeedbackMode,
  navHighlight,
  onNavHighlightToggle,
}: {
  prdRevisionId: string;
  prototypeSlug: string;
  siblings: Array<{ id: string; slug: string; description: string | null }>;
  onSiblingChange: (slug: string) => void;
  rounds: TreeResponse["rounds"];
  roundId: string | null;
  currentRoundId: string | null;
  onRoundId: (id: string) => void;
  roundPages: TreeResponse["pages"];
  electedPageIds: Set<string>;
  pageId: string | null;
  onPageId: (id: string) => void;
  variants: Variant[];
  variantIdx: number;
  onVariantIdx: (idx: number) => void;
  chosenVariantId: string | null;
  decisionRationale: string | null;
  electionPending: boolean;
  onElect: (variantId: string, rationale: string) => void;
  onUnelect: () => void;
  feedbackMode: FeedbackMode;
  setFeedbackMode: (mode: FeedbackMode) => void;
  navHighlight: boolean;
  onNavHighlightToggle: () => void;
}) {
  void prdRevisionId;
  const pinActive = feedbackMode === "pin";
  const sortedRounds = [...rounds].sort((a, b) => a.round.position - b.round.position);
  const selectedRound = sortedRounds.find((r) => r.round.id === roundId);
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-card-border bg-sidebar px-3 py-2 text-xs">
      <PickerField label="Prototype">
        <Select
          value={prototypeSlug}
          disabled={siblings.length <= 1}
          onValueChange={(v) => {
            if (typeof v === "string" && v !== prototypeSlug) onSiblingChange(v);
          }}
        >
          <SelectTrigger
            aria-label="Prototype"
            className="min-h-7 min-w-32 px-2 py-1 text-xs"
            size="sm"
          >
            <SelectValue>{prototypeSlug}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {siblings.map((p) => (
              <SelectItem key={p.id} value={p.slug}>
                {p.slug}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </PickerField>

      <PickerField label="Round">
        <Select
          value={roundId ?? ""}
          disabled={sortedRounds.length <= 1}
          onValueChange={(v) => {
            if (typeof v === "string" && v !== "" && v !== roundId) onRoundId(v);
          }}
        >
          <SelectTrigger
            aria-label="Round"
            className="min-h-7 min-w-32 px-2 py-1 text-xs"
            size="sm"
          >
            <SelectValue>
              {selectedRound
                ? `${selectedRound.round.label}${
                    selectedRound.round.id === currentRoundId ? " (courant)" : ""
                  }`
                : "—"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {sortedRounds.map((r) => (
              <SelectItem key={r.round.id} value={r.round.id}>
                {r.round.label}
                {r.round.id === currentRoundId ? " (courant)" : ""}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </PickerField>

      <PickerField label="Page">
        <Select
          value={pageId ?? ""}
          disabled={roundPages.length <= 1}
          onValueChange={(v) => {
            if (typeof v === "string" && v !== "") onPageId(v);
          }}
        >
          <SelectTrigger aria-label="Page" className="min-h-7 min-w-32 px-2 py-1 text-xs" size="sm">
            <SelectValue>
              {roundPages.find((p) => p.page.id === pageId)?.page.slug ?? "—"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {roundPages.map((p) => (
              <SelectItem key={p.page.id} value={p.page.id}>
                <span className="inline-flex items-center gap-1.5">
                  {p.page.slug}
                  {electedPageIds.has(p.page.id) ? (
                    <CheckIcon className="size-3 text-success" aria-label="design retenu" />
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </PickerField>

      <PickerField label="Variant">
        <Select
          value={String(variantIdx)}
          disabled={variants.length <= 1}
          onValueChange={(v) => {
            if (v !== null) onVariantIdx(Number(v));
          }}
        >
          <SelectTrigger
            aria-label="Variant"
            className="min-h-7 min-w-32 px-2 py-1 text-xs"
            size="sm"
          >
            <SelectValue>
              <span className="inline-flex items-center gap-1.5">
                {variants[variantIdx]?.label ?? "—"}
                {variants[variantIdx]?.isMain ? (
                  <Badge variant="neutral" className="text-[8px]">
                    MAIN
                  </Badge>
                ) : null}
                {variants[variantIdx] && chosenVariantId === variants[variantIdx].id ? (
                  <Badge variant="success" className="text-[8px]">
                    RETENU
                  </Badge>
                ) : null}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {variants.map((v, idx) => (
              <SelectItem key={v.id} value={String(idx)}>
                <span className="inline-flex items-center gap-1.5">
                  {v.label}
                  {v.isMain ? (
                    <Badge variant="neutral" className="text-[8px]">
                      MAIN
                    </Badge>
                  ) : null}
                  {chosenVariantId === v.id ? (
                    <Badge variant="success" className="text-[8px]">
                      RETENU
                    </Badge>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </PickerField>

      <ElectionControl
        currentVariant={variants[variantIdx] ?? null}
        variantsCount={variants.length}
        chosenVariantId={chosenVariantId}
        decisionRationale={decisionRationale}
        pending={electionPending}
        onElect={onElect}
        onUnelect={onUnelect}
      />

      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={pinActive ? "primary" : "secondary"}
          aria-pressed={pinActive}
          onClick={() => setFeedbackMode(pinActive ? "off" : "pin")}
          title={pinActive ? "Quitter le mode pin" : "Activer le mode pin"}
        >
          <MapPinIcon className="size-3.5" aria-hidden />
          <span>{pinActive ? "Pin actif" : "Mode pin"}</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant={navHighlight ? "info" : "secondary"}
          aria-pressed={navHighlight}
          onClick={onNavHighlightToggle}
          title={
            navHighlight
              ? "Masquer les liens navigables"
              : "Afficher les liens navigables du prototype"
          }
        >
          <Link2Icon className="size-3.5" aria-hidden />
          <span>{navHighlight ? "Liens actifs" : "Voir liens"}</span>
        </Button>
      </div>
    </div>
  );
}

/**
 * Election control next to the VARIANT picker (PRD 0028, mono-variant
 * refinement). Lets the human retain the displayed variant as THE design to
 * build for the page — the product decision, distinct from the agent-chosen
 * `MAIN`. Its affordance follows `electionAffordance`:
 *
 *   - `"elected"` — the displayed variant carries an explicit election: a
 *     "✓ Retenu" state plus a way to clear it.
 *   - `"auto"` — a single-variant page: nothing to choose, so it shows a muted,
 *     non-clickable "Seule variante — retenue d'office" indicator (no button, no
 *     green `RETENU` badge).
 *   - `"button"` — a genuine choice (≥ 2 variants, none elected): a "Retenir
 *     cette variante" button whose optional rationale is captured in a small
 *     inline popover before confirming.
 */
function ElectionControl({
  currentVariant,
  variantsCount,
  chosenVariantId,
  decisionRationale,
  pending,
  onElect,
  onUnelect,
}: {
  currentVariant: Variant | null;
  variantsCount: number;
  chosenVariantId: string | null;
  decisionRationale: string | null;
  pending: boolean;
  onElect: (variantId: string, rationale: string) => void;
  onUnelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!currentVariant) return null;

  const affordance = electionAffordance(variantsCount, { chosenVariantId }, currentVariant.id);

  if (affordance === "elected") {
    return (
      <PickerField label="Décision">
        <div className="flex min-h-7 items-center gap-2">
          <span
            className="inline-flex items-center gap-1 text-xs font-medium text-success-foreground"
            title={decisionRationale ?? undefined}
          >
            <CheckIcon className="size-3.5 text-success" aria-hidden />
            Retenu
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => onUnelect()}
            title="Annuler le choix de cette variante"
          >
            Annuler le choix
          </Button>
        </div>
      </PickerField>
    );
  }

  if (affordance === "auto") {
    return (
      <PickerField label="Décision">
        <span
          data-testid="election-auto"
          className="inline-flex min-h-7 items-center gap-1 text-xs text-muted-foreground"
          title="Une seule variante : retenue d'office, rien à choisir."
        >
          <CheckIcon className="size-3.5 text-muted-foreground" aria-hidden />
          Seule variante — retenue d'office
        </span>
      </PickerField>
    );
  }

  return (
    <PickerField label="Décision">
      <div ref={popoverRef} className="relative flex min-h-7 items-center">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={pending}
          aria-expanded={open}
          onClick={() => {
            setRationale("");
            setOpen((o) => !o);
          }}
          title="Retenir cette variante comme design à construire"
        >
          <CheckIcon className="size-3.5" aria-hidden />
          <span>Retenir cette variante</span>
        </Button>
        {open ? (
          <div
            role="dialog"
            aria-label="Retenir cette variante"
            data-testid="election-popover"
            className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-card-border bg-card p-2.5 shadow-xl"
          >
            <label
              htmlFor="depot-election-rationale"
              className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Pourquoi cette variante ? (optionnel)
            </label>
            <Textarea
              id="depot-election-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onElect(currentVariant.id, rationale.trim());
                  setOpen(false);
                }
              }}
              placeholder="Note d'arbitrage…"
              className="min-h-[56px] text-xs"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={pending}
                onClick={() => {
                  onElect(currentVariant.id, rationale.trim());
                  setOpen(false);
                }}
              >
                Confirmer
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </PickerField>
  );
}

/**
 * Viewport toolbar above the iframe — Storybook-style preset switcher.
 * Renders one button per preset, persists choice via the route component's
 * `viewport` state, and shows the resolved width (or “auto”) on the right
 * for at-a-glance confirmation of what the iframe is currently capped at.
 */
function ViewportToolbar({
  viewport,
  onViewportChange,
  wrapperRef,
}: {
  viewport: ViewportPresetKey;
  onViewportChange: (v: ViewportPresetKey) => void;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const active = VIEWPORT_PRESETS.find((p) => p.key === viewport);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    if (active?.width !== null) {
      setMeasured(active?.width ?? null);
      return;
    }
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setMeasured(Math.round(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active?.width, wrapperRef]);

  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Preview
      </div>
      <div className="flex items-center gap-2">
        <div
          className="inline-flex overflow-hidden rounded-md border border-card-border bg-card"
          role="group"
          aria-label="Viewport size"
        >
          {VIEWPORT_PRESETS.map((preset) => {
            const isActive = preset.key === viewport;
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => onViewportChange(preset.key)}
                aria-pressed={isActive}
                title={
                  preset.width === null
                    ? "Responsive (auto)"
                    : `${preset.label} · ${preset.width}px`
                }
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {measured !== null ? `${measured}px` : "—"}
        </span>
      </div>
    </div>
  );
}

function PickerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function ComposeForm({
  currentVariantId,
  text,
  setText,
  onSubmit,
  error,
  pending,
}: {
  currentVariantId: string | null;
  text: string;
  setText: (s: string) => void;
  onSubmit: (text: string) => Promise<void>;
  error: string | null;
  pending: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() && currentVariantId) void onSubmit(text.trim());
      }}
      className="shrink-0 border-t border-card-border bg-muted/40 p-3 text-xs"
    >
      <label htmlFor="depot-fb-compose" className="mb-1 block text-muted-foreground">
        Nouveau feedback global
      </label>
      <textarea
        id="depot-fb-compose"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (text.trim() && currentVariantId) void onSubmit(text.trim());
          }
        }}
        placeholder="Décris le retour. Cmd/Ctrl+Entrée pour envoyer."
        className="h-16 w-full resize-none rounded border border-card-border bg-background p-2 text-xs"
      />
      <div className="mt-1 text-[10px] text-muted-foreground">
        Pour épingler un feedback sur un élément précis, ouvre Feedback ▾ → Mode pin.
      </div>
      {error ? <div className="mt-1 text-[10px] text-red-500">{error}</div> : null}
      <div className="mt-2 flex justify-end">
        <Button type="submit" size="sm" disabled={!text.trim() || pending}>
          + feedback
        </Button>
      </div>
    </form>
  );
}
