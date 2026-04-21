/**
 * Embedded context template registry.
 * Templates are imported as text at build time so the binary remains self-contained.
 * The CLI never reads template files from disk at runtime.
 *
 * `with { type: "text" }` tells Bun to load the file as a plain string.
 * In vitest, the rawMdPlugin in vitest.config.ts handles .md files by extension.
 */

import prdContent from "#/context/prd.md" with { type: "text" };
import devContent from "#/context/dev.md" with { type: "text" };
import reviewContent from "#/context/review.md" with { type: "text" };

const CONTEXT_TEMPLATES: Record<string, string> = {
  prd: prdContent,
  dev: devContent,
  review: reviewContent,
};

export function getContextTemplate(mode: string): string {
  const content = CONTEXT_TEMPLATES[mode];
  if (!content) {
    throw new Error(
      `Unknown context mode: '${mode}'. Available: ${Object.keys(CONTEXT_TEMPLATES).join(", ")}`,
    );
  }
  return content;
}

export function listContextModes(): string[] {
  return Object.keys(CONTEXT_TEMPLATES);
}
