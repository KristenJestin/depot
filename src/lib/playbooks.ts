/**
 * Embedded playbook registry.
 * Playbooks are imported as text at build time so the binary remains self-contained.
 * The CLI never reads playbook files from disk at runtime.
 *
 * `with { type: "text" }` tells Bun to load the file as a plain string.
 * In vitest, the rawMdPlugin in vitest.config.ts handles .md files by extension.
 */

import prdContent from "#/playbooks/prd.md" with { type: "text" };
import devContent from "#/playbooks/dev.md" with { type: "text" };
import reviewContent from "#/playbooks/review.md" with { type: "text" };

const PLAYBOOKS: Record<string, string> = {
  prd: prdContent,
  dev: devContent,
  review: reviewContent,
};

export function getPlaybook(name: string): string {
  const content = PLAYBOOKS[name];
  if (!content) {
    throw new Error(`Unknown playbook: '${name}'. Available: ${Object.keys(PLAYBOOKS).join(", ")}`);
  }
  return content;
}

export function listPlaybooks(): string[] {
  return Object.keys(PLAYBOOKS);
}
