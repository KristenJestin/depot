import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Open `$EDITOR` (falling back to `nano`, then `vi`) on a temp file seeded
 * with `initialContent` and return the resulting body. Throws when the editor
 * exits non-zero. Throws when the result is empty after trimming and
 * `requireNonEmpty` is true.
 *
 * Honors `DEPOT_EDITOR_INPUT` for tests: when set, that value is returned
 * directly without invoking any external process.
 */
export function openEditorForText(options: {
  initialContent?: string;
  extension?: string;
  requireNonEmpty?: boolean;
}): string {
  const { initialContent = "", extension = ".md", requireNonEmpty = true } = options;

  const testOverride = process.env["DEPOT_EDITOR_INPUT"];
  if (testOverride !== undefined) {
    if (requireNonEmpty && testOverride.trim().length === 0) {
      throw new Error("Editor returned an empty value.");
    }
    return testOverride;
  }

  const editor = process.env["VISUAL"] || process.env["EDITOR"] || "nano";
  const dir = mkdtempSync(path.join(tmpdir(), "depot-editor-"));
  const file = path.join(dir, `depot${extension}`);

  try {
    writeFileSync(file, initialContent, "utf-8");
    const result = spawnSync(editor, [file], { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(
        `Editor '${editor}' exited with status ${result.status ?? "?"}.${
          result.error ? ` (${result.error.message})` : ""
        }`,
      );
    }
    const content = readFileSync(file, "utf-8");
    if (requireNonEmpty && content.trim().length === 0) {
      throw new Error("Editor returned an empty value.");
    }
    return content;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Default starter body for `depot adr create`. Suggests sections without forcing them. */
export const ADR_BODY_TEMPLATE = `# Title

## Context

Why are we deciding this now?

## Decision

What did we decide?

## Consequences

What does this change for the codebase, the team, future PRDs?

## Alternatives

What did we consider and reject?
`;
