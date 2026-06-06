// @vitest-environment happy-dom
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen } from "@testing-library/react";

import { ConfirmDialog } from "#/web/components/ui/confirm-dialog";

/**
 * Render tests for `ConfirmDialog`. The dialog wraps base-ui `Dialog`,
 * so the popup is portaled into `document.body` and the title/description
 * are queried from the global screen rather than a wrapper container.
 */
function Harness({
  onConfirm,
  destructive = false,
  loading = false,
}: {
  onConfirm: () => void;
  destructive?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Supprimer ce feedback ?"
      description="Cette action est irréversible."
      confirmLabel="Supprimer"
      cancelLabel="Annuler"
      destructive={destructive}
      loading={loading}
      onConfirm={onConfirm}
    />
  );
}

describe("ConfirmDialog", () => {
  it("renders the title, description and both buttons", () => {
    render(<Harness onConfirm={vi.fn<() => void>()} destructive />);
    expect(screen.getByText("Supprimer ce feedback ?")).toBeInTheDocument();
    expect(screen.getByText("Cette action est irréversible.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  });

  it("invokes onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn<() => void>();
    render(<Harness onConfirm={onConfirm} destructive />);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables both buttons while loading", () => {
    render(<Harness onConfirm={vi.fn<() => void>()} destructive loading />);
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeDisabled();
  });
});
