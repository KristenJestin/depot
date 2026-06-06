// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  PrdDependenciesWidget,
  PrdMilestoneWidget,
  PrdTagsWidget,
} from "#/web/components/prd-groupings-widget";

/**
 * PRD 0026 / S3 — smoke tests per widget verifying that the REST contract
 * is preserved after the refactor to `SidebarItemList` + `SidebarAddForm`.
 * Each test stubs `fetch`, triggers an add or remove, and asserts the
 * resulting URL / method / body.
 */

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to: _to,
    params: _params,
    search: _search,
    activeOptions: _activeOptions,
    ...props
  }: {
    children?: React.ReactNode;
    className?: string;
    to?: unknown;
    params?: unknown;
    search?: unknown;
    activeOptions?: unknown;
  } & React.ComponentPropsWithoutRef<"a">) => (
    <a href="#" className={className} {...props}>
      {children}
    </a>
  ),
}));

function wrap(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>;
}

describe("PrdTagsWidget (PRD 0026 / S3)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POSTs to /api/prds/:id/tags on add", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({}), { status: 201 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(wrap(<PrdTagsWidget prdRevisionId="rev-1" tags={[]} />));

    const input = screen.getByLabelText("Add tag") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "shipped" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/prds/rev-1/tags");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ tag: "shipped" }));
  });

  it("DELETEs to /api/prds/:id/tags/:tag on remove", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({}), { status: 204 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(wrap(<PrdTagsWidget prdRevisionId="rev-1" tags={["existing"]} />));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /remove existing/i }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/prds/rev-1/tags/existing");
    expect(init?.method).toBe("DELETE");
  });
});

describe("PrdMilestoneWidget (PRD 0026 / S3)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("PATCHes to /api/prds/:id/milestone on save", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(wrap(<PrdMilestoneWidget prdRevisionId="rev-1" version={null} />));

    // Switch into edit mode, then submit.
    fireEvent.click(screen.getByRole("button", { name: /set milestone/i }));
    const input = screen.getByLabelText("Milestone version") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2.6.1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/prds/rev-1/milestone");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ version: "2.6.1" }));
  });

  it("PATCHes /api/prds/:id/milestone with `null` to clear the milestone", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(wrap(<PrdMilestoneWidget prdRevisionId="rev-1" version="2.5.0" />));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /remove 2\.5\.0/i }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/prds/rev-1/milestone");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ version: null }));
  });
});

describe("PrdDependenciesWidget (PRD 0026 / S3)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POSTs to /api/prds/:id/dependencies on add", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({}), { status: 201 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(wrap(<PrdDependenciesWidget prdRevisionId="rev-1" dependencies={[]} dependents={[]} />));

    const input = screen.getByLabelText("Depend on PRD id") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "prd-foo" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/prds/rev-1/dependencies");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ dependsOnPrdId: "prd-foo" }));
  });

  it("DELETEs to /api/prds/:id/dependencies/:depId on remove", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({}), { status: 204 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(
      wrap(
        <PrdDependenciesWidget
          prdRevisionId="rev-1"
          dependencies={[
            {
              prdId: "prd-foo",
              headRevisionId: null,
              title: "Foo PRD",
              status: "in_progress",
            },
          ]}
          dependents={[]}
        />,
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /remove prd-foo/i }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/prds/rev-1/dependencies/prd-foo");
    expect(init?.method).toBe("DELETE");
  });
});
