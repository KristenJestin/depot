/**
 * Embedded context template registry.
 * Templates are imported as text at build time so the binary remains self-contained.
 * The CLI never reads template files from disk at runtime.
 *
 * `with { type: "text" }` tells Bun to load the file as a plain string.
 * In vitest, the rawMdPlugin in vitest.config.ts handles .md files by extension.
 */

import prdContent from "#/modules/context/templates/prd.md" with { type: "text" };
import devContent from "#/modules/context/templates/dev.md" with { type: "text" };
import coderContent from "#/modules/context/templates/coder.md" with { type: "text" };
import auditorContent from "#/modules/context/templates/auditor.md" with { type: "text" };
import docContent from "#/modules/context/templates/doc.md" with { type: "text" };
import shipContent from "#/modules/context/templates/ship.md" with { type: "text" };
import prototypeContent from "#/modules/context/templates/prototype.md" with { type: "text" };
import ideaContent from "#/modules/context/templates/idea.md" with { type: "text" };

const CONTEXT_TEMPLATES: Record<string, string> = {
  prd: prdContent,
  dev: devContent,
  coder: coderContent,
  auditor: auditorContent,
  doc: docContent,
  ship: shipContent,
  prototype: prototypeContent,
  idea: ideaContent,
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
