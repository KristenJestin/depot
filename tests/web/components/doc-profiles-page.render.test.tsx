// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { DocProfileDetailView, type DocProfileDetail } from "#/web/components/doc-profiles-page";

function makeProfile(overrides: Partial<DocProfileDetail> = {}): DocProfileDetail {
  return {
    id: "dp-1",
    name: "nyx-docs",
    projectId: "proj-1",
    targetRoot: "nyx-docs/src",
    targetPattern: "**/*.md",
    language: "fr",
    style: "reference",
    audience: "developers",
    commitPolicy: "commit-with-message",
    sources: [
      { name: "api", path: "./nyx-api" },
      { name: "front", path: "./nyx-front", includeGlobs: ["src/**"] },
    ],
    routingRules: [
      { sourcePathGlob: "src/**/*.ts", targetDocPath: "api/index.md", when: "merged" },
    ],
    topicsToCover: ["auth", "payments"],
    topicsToIgnore: ["scratch"],
    guardrails: ["No secrets in docs", "Keep code blocks runnable"],
    ...overrides,
  };
}

describe("DocProfileDetailView", () => {
  it("renders all metadata fields", () => {
    render(<DocProfileDetailView profile={makeProfile()} />);
    const detail = screen.getByTestId("doc-profile-detail");

    expect(within(detail).getByText("nyx-docs")).toBeInTheDocument();
    // target_root + target_pattern
    expect(within(detail).getByText("nyx-docs/src")).toBeInTheDocument();
    expect(within(detail).getByText("**/*.md")).toBeInTheDocument();
    // language / style / audience / commit_policy
    expect(within(detail).getByText("fr")).toBeInTheDocument();
    expect(within(detail).getAllByText("reference").length).toBeGreaterThan(0);
    expect(within(detail).getByText("developers")).toBeInTheDocument();
    expect(within(detail).getAllByText("commit-with-message").length).toBeGreaterThan(0);
    // sources
    expect(within(detail).getByText("api")).toBeInTheDocument();
    expect(within(detail).getByText("./nyx-api")).toBeInTheDocument();
    expect(within(detail).getByText("front")).toBeInTheDocument();
    // routing_rules
    expect(within(detail).getByText("src/**/*.ts")).toBeInTheDocument();
    expect(within(detail).getByText("api/index.md")).toBeInTheDocument();
    // topics_to_cover / topics_to_ignore
    expect(within(detail).getByText("auth")).toBeInTheDocument();
    expect(within(detail).getByText("payments")).toBeInTheDocument();
    expect(within(detail).getByText("scratch")).toBeInTheDocument();
    // guardrails
    expect(within(detail).getByText("No secrets in docs")).toBeInTheDocument();
    expect(within(detail).getByText("Keep code blocks runnable")).toBeInTheDocument();
  });

  it("renders em-dash placeholders for empty arrays and null audience", () => {
    render(
      <DocProfileDetailView
        profile={makeProfile({
          audience: null,
          sources: [],
          routingRules: [],
          topicsToCover: [],
          topicsToIgnore: [],
          guardrails: [],
        })}
      />,
    );
    const detail = screen.getByTestId("doc-profile-detail");
    // At least one placeholder for each empty section + audience.
    expect(within(detail).getAllByText("—").length).toBeGreaterThanOrEqual(6);
  });

  it("wires the Edit action", () => {
    const onEdit = vi.fn<() => void>();
    render(<DocProfileDetailView profile={makeProfile()} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
