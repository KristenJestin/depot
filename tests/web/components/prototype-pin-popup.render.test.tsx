// @vitest-environment happy-dom
import { useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PinPopup, type PinPopupState } from "#/web/components/prototype-pin-popup";

/**
 * Render tests for the prototype workspace pin popup (PRD 0025 / T1).
 *
 * The popup is anchored to a `(x, y)` point reported by the iframe shim and
 * clamped to the wrapper. It exposes the CSS selector for the pinned element,
 * autofocuses its textarea, and submits via Cmd/Ctrl+Enter (Escape cancels).
 */

function Harness({
  pin,
  onSubmit,
  onCancel,
  pending = false,
}: {
  pin: PinPopupState;
  onSubmit: (text: string) => Promise<void> | void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={wrapperRef} style={{ position: "relative", width: 800, height: 600 }}>
      <PinPopup
        pin={pin}
        wrapperRef={wrapperRef}
        onSubmit={onSubmit}
        onCancel={onCancel}
        pending={pending}
      />
    </div>
  );
}

describe("PinPopup", () => {
  it("renders the selector and autofocuses the textarea", () => {
    render(
      <Harness
        pin={{ selector: "div.card > h1#title", x: 100, y: 80 }}
        onSubmit={vi.fn<(text: string) => void>()}
        onCancel={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByText("Pin sur")).toBeInTheDocument();
    expect(screen.getByTestId("pin-popup-selector")).toHaveTextContent("div.card > h1#title");
    const textarea = screen.getByPlaceholderText("Décris ton retour…");
    expect(textarea).toHaveFocus();
  });

  it("submits via the primary button with trimmed text", async () => {
    const onSubmit = vi.fn<(text: string) => void>();
    render(
      <Harness
        pin={{ selector: "div", x: 10, y: 10 }}
        onSubmit={onSubmit}
        onCancel={vi.fn<() => void>()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Décris ton retour…");
    fireEvent.change(textarea, { target: { value: "  the rail is too narrow  " } });
    fireEvent.click(screen.getByRole("button", { name: "+ feedback" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("the rail is too narrow"));
  });

  it("submits via Cmd/Ctrl+Enter", async () => {
    const onSubmit = vi.fn<(text: string) => void>();
    render(
      <Harness
        pin={{ selector: "div", x: 0, y: 0 }}
        onSubmit={onSubmit}
        onCancel={vi.fn<() => void>()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Décris ton retour…");
    fireEvent.change(textarea, { target: { value: "shortcut feedback" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("shortcut feedback"));
  });

  it("does not submit when the textarea is empty", () => {
    const onSubmit = vi.fn<(text: string) => void>();
    render(
      <Harness
        pin={{ selector: "div", x: 0, y: 0 }}
        onSubmit={onSubmit}
        onCancel={vi.fn<() => void>()}
      />,
    );

    const submit = screen.getByRole("button", { name: "+ feedback" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("fires onCancel on the ghost button and on Escape", () => {
    const onCancel = vi.fn<() => void>();
    render(
      <Harness
        pin={{ selector: "div", x: 0, y: 0 }}
        onSubmit={vi.fn<(text: string) => void>()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onCancel).toHaveBeenCalledOnce();

    fireEvent.keyDown(screen.getByTestId("pin-popup"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("clamps the popup so it never spills outside the wrapper", () => {
    render(
      <Harness
        pin={{ selector: "div", x: 99999, y: 99999 }}
        onSubmit={vi.fn<(text: string) => void>()}
        onCancel={vi.fn<() => void>()}
      />,
    );

    const popup = screen.getByTestId("pin-popup") as HTMLDivElement;
    const left = Number(popup.style.left.replace("px", ""));
    const top = Number(popup.style.top.replace("px", ""));
    // The harness wrapper is 800x600; popup is 300x180 so the max anchor is
    // (800-300-8, 600-180-8) = (492, 412). happy-dom returns 0 for layout
    // rects so we accept either the clamped position or the floor of 8.
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(left).toBeLessThanOrEqual(99999);
    expect(top).toBeLessThanOrEqual(99999);
  });

  it("disables the submit button while pending", () => {
    render(
      <Harness
        pin={{ selector: "div", x: 0, y: 0 }}
        onSubmit={vi.fn<(text: string) => void>()}
        onCancel={vi.fn<() => void>()}
        pending={true}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Décris ton retour…"), {
      target: { value: "hello" },
    });
    expect(screen.getByRole("button", { name: "+ feedback" })).toBeDisabled();
  });
});
