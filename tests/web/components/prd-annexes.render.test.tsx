// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AnnexBodyMarkdown, PrdAnnexesSection } from "#/web/components/prd-annexes-widget";

/**
 * RTL coverage for PRD 0024 / T2 — the annexes web surface:
 *   1. PrdAnnexesSection lists each annex (name + kind badge + description) and
 *      previews an `html` annex inside a *sandboxed* iframe (no allow-scripts).
 *   2. AnnexBodyMarkdown turns `[annex: foo]` body mentions into clickable chips
 *      and renders a broken-link chip when no matching annex exists.
 */

type AnnexSummary = {
  id: string;
  name: string;
  kind: "html" | "markdown" | "code" | "text";
  description: string | null;
  createdAt: string;
};

function renderWithClient(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe("PrdAnnexesSection — list + sandboxed html preview (PRD 0024 / T2)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lists annexes and renders the html annex inside a sandboxed iframe", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ annex: { content: "<h1>Proto</h1>" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const annexes: AnnexSummary[] = [
      {
        id: "annex-1",
        name: "pointage-factures",
        kind: "html",
        description: "prototype du pointage de factures",
        createdAt: "2026-05-29T10:00:00.000Z",
      },
    ];

    renderWithClient(<PrdAnnexesSection prdRevisionId="rev-1" annexes={annexes} />);

    const card = screen.getByTestId("annex-card");
    expect(within(card).getByText("pointage-factures")).toBeInTheDocument();
    expect(within(card).getByTestId("annex-kind-badge")).toHaveTextContent("HTML");
    expect(within(card).getByText("prototype du pointage de factures")).toBeInTheDocument();

    // The preview content is fetched on demand; wait for the iframe to mount.
    const iframe = (await screen.findByTestId("annex-html-iframe")) as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    // Sandboxed with NO allow-scripts (PRD Q7): the attribute is present and empty.
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.getAttribute("sandbox") ?? "").not.toContain("allow-scripts");
    expect(iframe.getAttribute("srcdoc")).toContain("<h1>Proto</h1>");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/prds/rev-1/annexes/annex-1");
  });

  it("shows an empty state when the revision has no annexes", () => {
    renderWithClient(<PrdAnnexesSection prdRevisionId="rev-1" annexes={[]} />);
    expect(screen.getByText(/No annexes attached/i)).toBeInTheDocument();
  });
});

describe("AnnexBodyMarkdown — inline [annex: name] chips (PRD 0024 / T2)", () => {
  it("renders a clickable chip for a known annex and a broken chip for an unknown one", () => {
    render(
      <AnnexBodyMarkdown
        source="See the prototype [annex: pointage-factures] and the missing [annex: ghost]."
        annexNames={new Set(["pointage-factures"])}
      />,
    );

    const chip = screen.getByTestId("annex-chip");
    expect(chip).toHaveTextContent("pointage-factures");
    expect(chip.tagName).toBe("BUTTON");

    const broken = screen.getByTestId("annex-chip-broken");
    expect(broken).toHaveTextContent("ghost");
  });

  it("renders plain body markdown when there are no mentions", () => {
    render(<AnnexBodyMarkdown source="Just **prose**, no annex here." annexNames={new Set()} />);
    expect(screen.getByText("prose")).toBeInTheDocument();
    expect(screen.queryByTestId("annex-chip")).toBeNull();
    expect(screen.queryByTestId("annex-chip-broken")).toBeNull();
  });
});
