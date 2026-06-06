// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { FreeformDocActions, buildEditorUrl } from "#/web/routes/projects.$id.docs";

/**
 * PRD 0021 / T4 — freeform docs drill-in actions.
 *
 * The route's `FreeformDocActions` view component is rendered directly (the
 * router is mocked away) so the test stays free of router boilerplate. Verifies:
 *   - a freeform row shows "Open in editor" + "Copy path";
 *   - the Open link targets `<scheme><abs-path>` — default `vscode://file/`,
 *     or the configured `defaultEditor` scheme when set;
 *   - when the absolute path is unresolved, neither action is offered.
 */

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

const ABS = "/home/kris/Projects/nyx/nyx-docs/src/frontend/i18n.md";

describe("buildEditorUrl (PRD 0021 / T4)", () => {
  it("defaults to the vscode://file/ scheme when no editor is configured", () => {
    expect(buildEditorUrl(ABS, null)).toBe(`vscode://file/${ABS}`);
    expect(buildEditorUrl(ABS, "")).toBe(`vscode://file/${ABS}`);
    expect(buildEditorUrl(ABS, "   ")).toBe(`vscode://file/${ABS}`);
  });

  it("uses the configured editor scheme verbatim when set", () => {
    expect(buildEditorUrl(ABS, "cursor://file/")).toBe(`cursor://file/${ABS}`);
  });

  it("returns null when the absolute path is unresolved", () => {
    expect(buildEditorUrl(null, "vscode://file/")).toBeNull();
  });
});

describe("FreeformDocActions (PRD 0021 / T4)", () => {
  it("renders Open + Copy path; Open targets the default vscode:// URL with the resolved path", () => {
    render(<FreeformDocActions artifact={{ absPath: ABS }} />);

    const openLink = screen.getByRole("link", { name: /open in editor/i });
    expect(openLink.getAttribute("href")).toBe(`vscode://file/${ABS}`);

    expect(screen.getByRole("button", { name: /copy path/i })).toBeInTheDocument();
  });

  it("targets the configured editor scheme when defaultEditor is set", () => {
    render(<FreeformDocActions artifact={{ absPath: ABS }} defaultEditor="cursor://file/" />);

    const openLink = screen.getByRole("link", { name: /open in editor/i });
    expect(openLink.getAttribute("href")).toBe(`cursor://file/${ABS}`);
  });

  it("offers neither action and explains why when the path is unresolved", () => {
    render(<FreeformDocActions artifact={{ absPath: null }} />);

    expect(screen.queryByRole("link", { name: /open in editor/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy path/i })).toBeNull();
    expect(screen.getByText(/could not be resolved/i)).toBeInTheDocument();
  });

  it("copies the absolute path to the clipboard when Copy path is clicked", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<FreeformDocActions artifact={{ absPath: ABS }} />);
    screen.getByRole("button", { name: /copy path/i }).click();

    expect(writeText).toHaveBeenCalledWith(ABS);
  });
});
