// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { PrdReposWidget } from "#/web/components/prd-repos-widget";

describe("PrdReposWidget", () => {
  it("lists the repos currently declared in the PRD's scope", () => {
    render(
      <PrdReposWidget
        items={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
          {
            id: "repo-front",
            name: "front",
            path: "/tmp/front",
            isPrimary: false,
            baseBranch: "main",
          },
        ]}
        projectRepos={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
          {
            id: "repo-front",
            name: "front",
            path: "/tmp/front",
            isPrimary: false,
            baseBranch: "main",
          },
          {
            id: "repo-docs",
            name: "docs",
            path: "/tmp/docs",
            isPrimary: false,
            baseBranch: "main",
          },
        ]}
        implicit={false}
        onAdd={vi.fn<(repoName: string) => void>()}
        onRemove={vi.fn<(repoName: string) => void>()}
      />,
    );

    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("front")).toBeInTheDocument();
  });

  it("marks the section non-applicable in mono-repo projects", () => {
    render(
      <PrdReposWidget
        items={[]}
        projectRepos={[]}
        implicit={true}
        onAdd={vi.fn<(repoName: string) => void>()}
        onRemove={vi.fn<(repoName: string) => void>()}
      />,
    );

    expect(screen.getByText(/not applicable/i)).toBeInTheDocument();
    // No add control should be offered when no project_repo exists.
    expect(screen.queryByRole("button", { name: /^Add$/i })).not.toBeInTheDocument();
  });

  it("renders add candidates in the coss select popup", () => {
    render(
      <PrdReposWidget
        items={[]}
        projectRepos={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
          {
            id: "repo-docs",
            name: "docs",
            path: "/tmp/docs",
            isPrimary: false,
            baseBranch: "main",
          },
        ]}
        implicit={false}
        onAdd={vi.fn<(repoName: string) => void>()}
        onRemove={vi.fn<(repoName: string) => void>()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/repo to add/i));
    expect(screen.getByRole("option", { name: "api" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "docs" })).toBeInTheDocument();
  });

  it("invokes onRemove when removing a declared repo", () => {
    const onRemove = vi.fn<(repoName: string) => void>();
    render(
      <PrdReposWidget
        items={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
        ]}
        projectRepos={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
        ]}
        implicit={false}
        onAdd={vi.fn<(repoName: string) => void>()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove api/i }));
    expect(onRemove).toHaveBeenCalledWith("api");
  });

  it("does not offer already-declared repos as add candidates", () => {
    render(
      <PrdReposWidget
        items={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
        ]}
        projectRepos={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
          {
            id: "repo-front",
            name: "front",
            path: "/tmp/front",
            isPrimary: false,
            baseBranch: "main",
          },
        ]}
        implicit={false}
        onAdd={vi.fn<(repoName: string) => void>()}
        onRemove={vi.fn<(repoName: string) => void>()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/repo to add/i));
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: "api" })).not.toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "front" })).toBeInTheDocument();
  });

  it("surfaces the domain error message when add fails", () => {
    render(
      <PrdReposWidget
        items={[]}
        projectRepos={[
          { id: "repo-api", name: "api", path: "/tmp/api", isPrimary: false, baseBranch: "main" },
        ]}
        implicit={false}
        onAdd={vi.fn<(repoName: string) => void>()}
        onRemove={vi.fn<(repoName: string) => void>()}
        error="Repo 'api' does not belong to project 'proj-1'"
      />,
    );

    expect(screen.getByText("Repo 'api' does not belong to project 'proj-1'")).toBeInTheDocument();
  });
});
