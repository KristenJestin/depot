// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DotLoader } from "#/web/components/ui/dot-loader";

describe("DotLoader rendu", () => {
  it("monte sans erreur avec le preset thinking", () => {
    render(<DotLoader preset="thinking" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("affiche le label quand fourni", () => {
    render(<DotLoader preset="thinking" label="Chargement" />);
    expect(screen.getByText("Chargement")).toBeVisible();
  });

  it("monte sans erreur pour chaque preset", () => {
    const presets = [
      "thinking",
      "searching",
      "analysing",
      "reading",
      "debugging",
      "generating",
      "soft-spin",
      "subtle-scan",
      "terminal",
    ] as const;
    for (const preset of presets) {
      const { unmount } = render(<DotLoader preset={preset} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      unmount();
    }
  });

  it("utilise aria-label par défaut 'Loading'", () => {
    render(<DotLoader />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});
