// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { TaskRepoSelector } from "#/web/components/task-repo-selector";

describe("TaskRepoSelector", () => {
  it("offers exactly the PRD's prd_repo entries + a 'no repo' choice", () => {
    render(
      <TaskRepoSelector
        currentRepoId={null}
        prdRepos={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
          {
            id: "repo-front",
            name: "front",
            path: "/tmp/front",
            isPrimary: false,
            baseBranch: "main",
          },
        ]}
        onChange={vi.fn<(repoId: string | null) => void>()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/^Repo$/));
    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(within(listbox).getByRole("option", { name: "api" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "front" })).toBeInTheDocument();

    // The "no repo" option is explicitly labelled.
    expect(within(listbox).getByRole("option", { name: /no repo/i })).toBeInTheDocument();
  });

  it("renders the current repo value in the coss select trigger", () => {
    render(
      <TaskRepoSelector
        currentRepoId="repo-api"
        prdRepos={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
          {
            id: "repo-front",
            name: "front",
            path: "/tmp/front",
            isPrimary: false,
            baseBranch: "main",
          },
        ]}
        onChange={vi.fn<(repoId: string | null) => void>()}
      />,
    );

    expect(screen.getByLabelText(/^Repo$/)).toHaveTextContent("api");
  });

  it("renders a hint when the PRD has no repo scope yet (multi-repo project, empty prd_repo)", () => {
    render(
      <TaskRepoSelector
        currentRepoId={null}
        prdRepos={[]}
        onChange={vi.fn<(repoId: string | null) => void>()}
      />,
    );

    expect(screen.getByText(/no repo declared/i)).toBeInTheDocument();
  });

  it("shows an error message when one is provided", () => {
    render(
      <TaskRepoSelector
        currentRepoId={null}
        prdRepos={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
        ]}
        onChange={vi.fn<(repoId: string | null) => void>()}
        error="Repo 'repo-api' is not in the PRD's repo scope. Add it first with 'depot prd repos add <prdId> <repoName>'."
      />,
    );

    expect(screen.getByText(/not in the PRD's repo scope/)).toBeInTheDocument();
  });
});
