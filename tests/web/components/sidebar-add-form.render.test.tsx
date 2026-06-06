// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { SidebarAddForm } from "#/web/components/ui/sidebar-add-form";

/**
 * PRD 0026 / S3 — generic add form shared by the Tags / Milestone /
 * Dependencies widgets. The form owns the draft state, trims on submit,
 * resets on success and respects `pending`.
 */

describe("SidebarAddForm", () => {
  it("calls `onAdd` with the trimmed input value when submitted", () => {
    const onAdd = vi.fn<(value: string) => void>();
    render(<SidebarAddForm placeholder="kebab-case" ariaLabel="Add tag" onAdd={onAdd} />);

    const input = screen.getByLabelText("Add tag") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  shipped  " } });
    const button = screen.getByRole("button", { name: /^Add$/ });
    fireEvent.click(button);

    expect(onAdd).toHaveBeenCalledWith("shipped");
  });

  it("ignores an empty submission (input is blank or whitespace)", () => {
    const onAdd = vi.fn<(value: string) => void>();
    render(<SidebarAddForm placeholder="kebab-case" ariaLabel="Add tag" onAdd={onAdd} />);

    const button = screen.getByRole("button", { name: /^Add$/ });
    fireEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();

    const input = screen.getByLabelText("Add tag") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("disables the submit button while the input is empty", () => {
    render(<SidebarAddForm placeholder="kebab-case" ariaLabel="Add tag" onAdd={() => {}} />);

    const button = screen.getByRole("button", { name: /^Add$/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const input = screen.getByLabelText("Add tag") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "shipped" } });
    expect(button.disabled).toBe(false);
  });

  it("disables the submit button while `pending` is true", () => {
    render(
      <SidebarAddForm placeholder="kebab-case" ariaLabel="Add tag" onAdd={() => {}} pending />,
    );
    const input = screen.getByLabelText("Add tag") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "shipped" } });

    const button = screen.getByRole("button", { name: /^Add$/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("resets the draft after a successful submission", async () => {
    const onAdd = vi.fn<(value: string) => void>();
    render(<SidebarAddForm placeholder="kebab-case" ariaLabel="Add tag" onAdd={onAdd} />);

    const input = screen.getByLabelText("Add tag") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "shipped" } });
    const button = screen.getByRole("button", { name: /^Add$/ });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onAdd).toHaveBeenCalledWith("shipped");
    expect(input.value).toBe("");
  });

  it("supports a custom button label", () => {
    render(
      <SidebarAddForm
        placeholder="version"
        ariaLabel="Milestone version"
        onAdd={() => {}}
        buttonLabel="Save"
      />,
    );
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeInTheDocument();
  });
});
