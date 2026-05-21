// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Layout test for the review-diff page: `split-resizable` with a resizable
 * left pane (file tree + collapsible PRD context), the `<DiffViewer>` in the
 * center, and a collapsible annotations rail on the right. The bottom
 * `floating-toolbar` stays mounted regardless of scroll.
 */
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => vi.fn<() => void>(),
  Link: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <a href="#" className={className}>
      {children}
    </a>
  ),
}));

vi.mock("#/web/lib/queries", () => ({
  prdsQuery: {
    detail: {
      useSuspense: (_id: string) => ({
        data: {
          prd: { id: "prd-1", title: "Layout PRD", currentPhase: null },
          tasks: [],
        },
      }),
    },
  },
}));

const DIFF_RESPONSE = {
  mode: "working-tree" as const,
  since: null,
  until: null,
  diff: "",
  files: [{ path: "src/foo.ts", additions: 1, deletions: 1 }],
  repos: [
    {
      repoName: "(default)",
      repoPath: "/repo",
      sha: null,
      diff: `diff --git a/src/foo.ts b/src/foo.ts
index 0000000..1111111 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
`,
      files: [{ path: "src/foo.ts", additions: 1, deletions: 1 }],
    },
  ],
};

function installLocalStorage() {
  if (typeof window.localStorage?.clear === "function") return;
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
}

beforeEach(() => {
  installLocalStorage();
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/diff")) {
        return new Response(JSON.stringify(DIFF_RESPONSE), { status: 200 });
      }
      if (url.includes("/context-panel")) {
        return new Response(
          JSON.stringify({
            reviewBrief: null,
            currentPhaseTasks: [],
            futurePhases: [],
            outOfScopeItems: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/git-status")) {
        return new Response(
          JSON.stringify({
            ok: true,
            branch: "feat/x",
            upstream: null,
            ahead: 0,
            behind: 0,
            files: [],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          phase: null,
          phaseSuggestedCommitMessage: null,
          prdSuggestedCommitMessage: null,
          suggestedCommitMessage: null,
        }),
        { status: 200 },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderRoute() {
  const mod = await import("#/web/routes/prds.$id.review-diff");
  const route = mod.Route as unknown as {
    component: () => React.ReactElement;
    useParams: () => { id: string };
  };
  route.useParams = () => ({ id: "prd-1" });
  const Component = route.component;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}

describe("review-diff page layout", () => {
  it("renders the diff in the center with a resizable split and an annotations rail", async () => {
    const { container } = await renderRoute();

    await waitFor(() => {
      expect(container.querySelector('[data-file-path="src/foo.ts"]')).not.toBeNull();
    });

    // The resizable divider separating the left pane from the diff.
    expect(
      container.querySelector('[role="separator"][aria-orientation="vertical"]'),
    ).not.toBeNull();

    // The annotations rail is the only `aside`, open by default.
    const sidebars = [...container.querySelectorAll("aside")];
    expect(sidebars.length).toBe(1);
    expect(sidebars[0]!.getAttribute("aria-hidden")).toBe("false");
    expect(sidebars[0]!.className).toContain("w-80");
  });

  it("collapses the annotations rail via the visible toggle", async () => {
    const { container } = await renderRoute();
    await waitFor(() => {
      expect(container.querySelector('[data-file-path="src/foo.ts"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /Annotations/ }));

    await waitFor(() => {
      const rail = container.querySelector("aside")!;
      expect(rail.getAttribute("aria-hidden")).toBe("true");
      expect(rail.className).toContain("w-0");
    });
  });

  it("keeps the floating toolbar mounted with Submit review and Discard actions", async () => {
    await renderRoute();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Submit review/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^Discard$/ })).toBeInTheDocument();
  });
});
