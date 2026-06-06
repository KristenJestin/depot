import { Effect } from "effect";
import { listDirectives } from "#/modules/projects/directives";
import {
  getCurrentRound,
  getPage,
  getPrototype,
  getRoundPageEntry,
  getRoundPagePlacement,
  loadPrototypeTree,
} from "#/modules/prds/prototypes";
import { listTaskPages } from "#/modules/prds/task-pages";
import { listIdeas } from "#/modules/ideas/domain";
import { Db } from "#/services/database";
import { DatabaseError, PrototypeNotFoundError } from "#/shared/errors";
import {
  VALID_DIRECTIVE_CATEGORIES,
  VALID_DIRECTIVE_SCOPES,
  isValidCategoryScope,
} from "#/shared/validator";
import type { DirectiveCategory, DirectiveScope } from "#/shared/validator";
import type {
  PrdPrototypeFeedbackRow,
  PrdPrototypePageRow,
  PrdPrototypePageVersionRow,
  PrdPrototypeVariantRow,
  PrdRoundPageDesignRow,
  ProjectDirectiveRow,
} from "#/db/schema";
import { formatRelativeTime } from "#/shared/utils";

// PRD 0013 / T2 — Renderer for inline directives and hooks.
//
// Two markers are recognised, with a deliberately strict grammar (no optional
// whitespace, fixed attribute order). Anything that does not match is left in
// place — a fail-loud signal for the template author.
//
//   {{directives scope=<name> category=<cat>}}
//   {{hooks      scope=<name> category=<cat>}}
//
// Markers inside a fenced code block (``` … ```) are intentionally NOT
// substituted, so a template can document the syntax with examples.

// Anchored variant for `parseMarker`, global variant reused by `substituteLine`
// so we only compile the pattern twice for the whole module.
const MARKER_REGEX_ANCHORED = /^\{\{(directives|hooks) scope=([\w-]+) category=([\w-]+)\}\}$/;
const MARKER_REGEX_GLOBAL = /\{\{(directives|hooks) scope=([\w-]+) category=([\w-]+)\}\}/g;
const FENCE_REGEX = /^\s*```/;

// PRD 0025: dynamic `{{prototype_state prototypeId=<id>}}` marker rendered to a
// structured prose block (pages → versions → variants → derived feedback
// buckets). `prototypeId` is required; without it the renderer leaves an inline
// error so the template author sees it.
const PROTOTYPE_STATE_REGEX_GLOBAL = /\{\{prototype_state(?:\s+([^}]*))?\}\}/g;

// PRD 0027: dynamic `{{idea_state}}` marker rendered to a compact list of the
// project's open ideas (newest-first), or a `_No open ideas._` placeholder when
// empty. It carries no attribute — it resolves against the `projectId` already
// threaded through `renderTemplate`, since ideas are project-scoped.
const IDEA_STATE_REGEX_GLOBAL = /\{\{idea_state\}\}/g;

// PRD 0030 / issue 05: dynamic `{{task_placement taskId=<id>}}` marker — the
// final link of the placement handoff. It renders, for the task in hand, the
// prototype pages it is linked to and each page's validated placement in its
// prototype's CURRENT round (and nothing else). `taskId` is required; without
// it the renderer leaves an inline error so the template author sees it.
const TASK_PLACEMENT_REGEX_GLOBAL = /\{\{task_placement(?:\s+([^}]*))?\}\}/g;

type MarkerKind = "directives" | "hooks";

interface ParsedMarker {
  kind: MarkerKind;
  scope: DirectiveScope;
  category: DirectiveCategory;
}

const parseMarker = (raw: string): ParsedMarker | null => {
  const match = raw.match(MARKER_REGEX_ANCHORED);
  if (!match) return null;
  const [, kindRaw, scopeRaw, categoryRaw] = match;
  const scope = scopeRaw as DirectiveScope;
  const category = categoryRaw as DirectiveCategory;
  if (!(VALID_DIRECTIVE_SCOPES as readonly string[]).includes(scope)) return null;
  if (!(VALID_DIRECTIVE_CATEGORIES as readonly string[]).includes(category)) return null;
  if (!isValidCategoryScope(category, scope)) return null;
  return { kind: kindRaw as MarkerKind, scope, category };
};

const emptyPlaceholder = (kind: MarkerKind): string =>
  kind === "hooks" ? "_No project hooks at this stage._" : "_No project directives at this stage._";

const headerFor = (marker: ParsedMarker): string => {
  if (marker.kind === "directives") {
    return [
      `### Project ground rules (${marker.scope})`,
      "",
      "These ground rules apply throughout your work.",
      "They are declared by the project itself.",
    ].join("\n");
  }
  return [
    `### Project hooks at this stage (${marker.scope})`,
    "",
    "You MUST follow these project-specific hooks before proceeding.",
    "They are declared by the project itself.",
  ].join("\n");
};

const tagFor = (directive: ProjectDirectiveRow): string => {
  const blocking = directive.blocking ? "blocking" : "advisory";
  return `[${blocking} ${directive.kind}]`;
};

const renderDirective = (directive: ProjectDirectiveRow, index: number): string => {
  const lines: string[] = [];
  lines.push(`${index + 1}. **${directive.title}** ${tagFor(directive)}`);
  lines.push("");
  lines.push(`   ${directive.instruction}`);
  if (directive.kind === "command") {
    const target = directive.repoTarget;
    const showTarget = target && target !== "auto";
    lines.push("");
    lines.push(
      showTarget
        ? `   Run: \`${directive.instruction}\` (in ${target})`
        : `   Run: \`${directive.instruction}\``,
    );
  }
  return lines.join("\n");
};

const renderMarker = (marker: ParsedMarker, directives: readonly ProjectDirectiveRow[]): string => {
  if (directives.length === 0) return emptyPlaceholder(marker.kind);
  const body = directives.map((d, i) => renderDirective(d, i)).join("\n\n");
  return `${headerFor(marker)}\n\n${body}`;
};

/**
 * Render every `{{directives}}` / `{{hooks}}` marker in `template` against
 * the project's current directives. Lines inside a fenced code block are
 * passed through verbatim — including markers that look like the real thing.
 *
 * Malformed markers (missing attribute, wrong order, extra whitespace,
 * unknown scope/category, invalid `(category, scope)` pair) are deliberately
 * left untouched so the template author sees the broken marker in the
 * rendered output.
 */
export const renderTemplate = (
  template: string,
  projectId: string,
): Effect.Effect<string, DatabaseError, Db> =>
  Effect.gen(function* () {
    const lines = template.split("\n");
    const rendered: string[] = [];
    let inFence = false;
    for (const line of lines) {
      if (FENCE_REGEX.test(line)) {
        inFence = !inFence;
        rendered.push(line);
        continue;
      }
      if (inFence) {
        rendered.push(line);
        continue;
      }
      rendered.push(yield* substituteLine(line, projectId));
    }
    return rendered.join("\n");
  });

const substituteLine = (
  line: string,
  projectId: string,
): Effect.Effect<string, DatabaseError, Db> =>
  Effect.gen(function* () {
    // matchAll resets the global regex's lastIndex, so reusing the module-level
    // pattern is safe and avoids recompiling per template line.
    const matches = [...line.matchAll(MARKER_REGEX_GLOBAL)];
    const protoMatches = [...line.matchAll(PROTOTYPE_STATE_REGEX_GLOBAL)];
    const ideaMatches = [...line.matchAll(IDEA_STATE_REGEX_GLOBAL)];
    const placementMatches = [...line.matchAll(TASK_PLACEMENT_REGEX_GLOBAL)];
    if (
      matches.length === 0 &&
      protoMatches.length === 0 &&
      ideaMatches.length === 0 &&
      placementMatches.length === 0
    ) {
      return line;
    }

    // Merge the match sets so the original substitution order is preserved even
    // when several kinds of marker appear on the same line.
    type AnyMatch =
      | { start: number; raw: string; kind: "marker" }
      | {
          start: number;
          raw: string;
          kind: "proto";
          attrs: string;
        }
      | { start: number; raw: string; kind: "idea" }
      | { start: number; raw: string; kind: "placement"; attrs: string };
    const all: AnyMatch[] = [];
    for (const m of matches) {
      all.push({ start: m.index ?? 0, raw: m[0], kind: "marker" });
    }
    for (const m of protoMatches) {
      all.push({ start: m.index ?? 0, raw: m[0], kind: "proto", attrs: m[1] ?? "" });
    }
    for (const m of ideaMatches) {
      all.push({ start: m.index ?? 0, raw: m[0], kind: "idea" });
    }
    for (const m of placementMatches) {
      all.push({ start: m.index ?? 0, raw: m[0], kind: "placement", attrs: m[1] ?? "" });
    }
    all.sort((a, b) => a.start - b.start);

    let out = "";
    let cursor = 0;
    for (const entry of all) {
      out += line.slice(cursor, entry.start);
      if (entry.kind === "marker") {
        const marker = parseMarker(entry.raw);
        if (!marker) {
          out += entry.raw;
        } else {
          const directives = yield* listDirectives(projectId, {
            scope: marker.scope,
            category: marker.category,
            enabledOnly: true,
          });
          out += renderMarker(marker, directives);
        }
      } else if (entry.kind === "proto") {
        out += yield* renderPrototypeStateMarker(entry.attrs);
      } else if (entry.kind === "placement") {
        out += yield* renderTaskPlacementMarker(entry.attrs);
      } else {
        out += yield* renderIdeaStateMarker(projectId);
      }
      cursor = entry.start + entry.raw.length;
    }
    out += line.slice(cursor);
    return out;
  });

// ── Prototype state marker ───────────────────────────────────────────────────

const parseProtoIdAttr = (attrs: string): string | null => {
  // Strict grammar `prototypeId=<value>`. Value is required, no quoting.
  const match = attrs.trim().match(/^prototypeId=([\w-]+)$/);
  return match ? match[1]! : null;
};

const formatFeedbackLine = (fb: PrdPrototypeFeedbackRow): string => {
  const pin = fb.selectorCss ? `[pin ${fb.selectorCss}] ` : "";
  return `${pin}"${fb.text}"`;
};

const renderVariantBlock = (
  variant: PrdPrototypeVariantRow,
  feedbacks: PrdPrototypeFeedbackRow[],
): string => {
  const marker = variant.isMain ? " [main]" : "";
  const lines: string[] = [`        - ${variant.label}${marker} (id: ${variant.id})`];
  const openOnVariant = feedbacks.filter((f) => f.variantId === variant.id && f.status === "open");
  for (const fb of openOnVariant) {
    lines.push(`          · ${formatFeedbackLine(fb)}`);
  }
  return lines.join("\n");
};

const renderVersionBlock = (
  version: PrdPrototypePageVersionRow,
  variants: PrdPrototypeVariantRow[],
  feedbacks: PrdPrototypeFeedbackRow[],
  isLatestActive: boolean,
): string => {
  const status = isLatestActive
    ? "latest"
    : version.archivedAt
      ? "archived"
      : "older — addressed by a newer version";
  const age = formatRelativeTime(version.createdAt);
  const lines: string[] = [`    Version ${version.label} (${status}, ${age})`];
  if (variants.length > 0) {
    lines.push(`      Variants:`);
    for (const variant of variants) {
      lines.push(renderVariantBlock(variant, feedbacks));
    }
  } else {
    lines.push(`      (no variants yet)`);
  }
  // Open feedbacks on this version that are still actionable (only when this is
  // the latest active version — otherwise they are surfaced under "Resolved").
  if (isLatestActive) {
    const openVariantIds = new Set(variants.map((v) => v.id));
    const openCount = feedbacks.filter(
      (f) => f.status === "open" && openVariantIds.has(f.variantId),
    ).length;
    lines.push(`      Open feedbacks (still actionable): ${openCount}`);
  } else {
    const variantIds = new Set(variants.map((v) => v.id));
    const resolvedDerived = feedbacks.filter(
      (f) => f.status === "open" && variantIds.has(f.variantId),
    );
    if (resolvedDerived.length > 0) {
      lines.push(`      Resolved feedbacks (open on ${version.label}, derived as addressed):`);
      for (const fb of resolvedDerived) {
        lines.push(`        - ${formatFeedbackLine(fb)}`);
        if (fb.resolutionNote || fb.resolutionViaVariantId) {
          const via = fb.resolutionViaVariantId ? ` via ${fb.resolutionViaVariantId}` : "";
          const note = fb.resolutionNote ? ` · note: "${fb.resolutionNote}"` : "";
          lines.push(`          → annotated${via}${note}`);
        }
      }
    }
    const ignored = feedbacks.filter((f) => f.status === "ignored" && variantIds.has(f.variantId));
    if (ignored.length > 0) {
      lines.push(`      Ignored feedbacks:`);
      for (const fb of ignored) {
        lines.push(
          `        - ${formatFeedbackLine(fb)}\n          → reason: "${fb.ignoredReason ?? ""}"`,
        );
      }
    }
  }
  return lines.join("\n");
};

const renderPageBlock = (
  page: PrdPrototypePageRow,
  versions: Array<{
    version: PrdPrototypePageVersionRow;
    variants: PrdPrototypeVariantRow[];
    feedbacks: PrdPrototypeFeedbackRow[];
  }>,
): string => {
  const activeVersions = versions.filter((v) => v.version.archivedAt === null);
  const latestActive = activeVersions.at(-1);
  const lines: string[] = [
    `  Page: ${page.slug} (${versions.length} version${versions.length === 1 ? "" : "s"})`,
  ];
  for (const entry of versions) {
    lines.push(
      renderVersionBlock(
        entry.version,
        entry.variants,
        entry.feedbacks,
        latestActive?.version.id === entry.version.id,
      ),
    );
  }
  return lines.join("\n");
};

/**
 * Render a `{{prototype_state prototypeId=<id>}}` marker against the live
 * prototype tree. Missing `prototypeId` → inline error so the template author
 * fixes the marker. Empty prototype → `_No pages yet._` placeholder.
 */
const renderPrototypeStateMarker = (attrs: string): Effect.Effect<string, DatabaseError, Db> =>
  Effect.gen(function* () {
    const prototypeId = parseProtoIdAttr(attrs);
    if (!prototypeId) {
      return "<!-- {{prototype_state}} requires prototypeId=<id> attribute -->";
    }
    const result = yield* loadPrototypeTree(prototypeId).pipe(
      Effect.catchTag("PrototypeNotFoundError", () => Effect.succeed(null)),
    );
    if (!result) {
      return `<!-- {{prototype_state}}: prototype ${prototypeId} not found -->`;
    }
    const { prototype, pages } = result;
    if (pages.length === 0) {
      return `Prototype: ${prototype.slug} (slug)\n_No pages yet._`;
    }
    const header = `Prototype: ${prototype.slug} (slug)`;
    return [header, ...pages.map((entry) => renderPageBlock(entry.page, entry.versions))].join(
      "\n",
    );
  });

// ── Idea state marker ─────────────────────────────────────────────────────────

/**
 * Render an `{{idea_state}}` marker against the project's open ideas. The marker
 * takes no attribute — it resolves against the `projectId` threaded through
 * `renderTemplate`. Each open idea (newest-first) renders as
 * `<id>  <title>  [tag]` (the `[tag]` suffix is omitted when the idea is
 * untagged); an empty backlog renders the `_No open ideas._` placeholder.
 */
const renderIdeaStateMarker = (projectId: string): Effect.Effect<string, DatabaseError, Db> =>
  Effect.gen(function* () {
    const open = yield* listIdeas(projectId, { status: "open" });
    if (open.length === 0) return "_No open ideas._";
    return open
      .map((idea) => {
        const tag = idea.tag ? `  [${idea.tag}]` : "";
        return `${idea.id}  ${idea.title}${tag}`;
      })
      .join("\n");
  });

// ── Task placement marker (PRD 0030 / issue 05) ──────────────────────────────

const parseTaskIdAttr = (attrs: string): string | null => {
  // Strict grammar `taskId=<value>`, mirroring the prototype_state marker.
  const match = attrs.trim().match(/^taskId=([\w-]+)$/);
  return match ? match[1]! : null;
};

/**
 * Render a `{{task_placement taskId=<id>}}` marker — the scoped placement handoff
 * (PRD 0030 / issue 05). For the task in hand it lists the prototype pages it is
 * linked to (`task_prototype_pages`) and, per page, the validated placement
 * distilled in that page's prototype CURRENT round — and nothing else.
 *
 * - Missing `taskId` → inline error so the template author fixes the marker.
 * - The task has no linked page → a neutral placeholder, never an error: a task
 *   that builds no prototype page is the common case.
 * - A linked page with no placement in the current round → a brief
 *   "not distilled yet" note rather than a crash.
 */
const renderTaskPlacementMarker = (attrs: string): Effect.Effect<string, DatabaseError, Db> =>
  Effect.gen(function* () {
    const taskId = parseTaskIdAttr(attrs);
    if (!taskId) {
      return "<!-- {{task_placement}} requires taskId=<id> attribute -->";
    }
    const pages = yield* listTaskPages(taskId);
    if (pages.length === 0) {
      return "_No prototype pages linked to this task._";
    }

    const blocks: string[] = [];
    for (const page of pages) {
      const placement = yield* resolveCurrentRoundPlacement(page.id);
      const heading = `### Page: ${page.title} (${page.slug})`;
      if (placement === null) {
        blocks.push(`${heading}\n\n_Placement not distilled yet for the current round._`);
      } else {
        blocks.push(`${heading}\n\n${placement.placementSpec}`);
      }
    }
    return blocks.join("\n\n");
  });

/**
 * Resolve a page's placement in its prototype's current round, or `null` when
 * the prototype has no round or the page has not been distilled in it. Reads the
 * page → prototype → current round chain, then the `(round, page)` placement.
 */
const resolveCurrentRoundPlacement = (
  pageId: string,
): Effect.Effect<PrdRoundPageDesignRow | null, DatabaseError, Db> =>
  Effect.gen(function* () {
    const page = yield* getPage(pageId).pipe(
      Effect.catchTag("PrototypePageNotFoundError", () => Effect.succeed(null)),
    );
    if (!page) return null;
    const prototype = yield* getPrototype(page.prototypeId).pipe(
      Effect.catchTag("PrototypeNotFoundError", () => Effect.succeed(null)),
    );
    if (!prototype) return null;
    const round = yield* getCurrentRound(prototype.id);
    if (!round) return null;
    const entry = yield* getRoundPageEntry(round.id, pageId);
    if (!entry) return null;
    return yield* getRoundPagePlacement(round.id, pageId);
  });

// Silence unused-import warning when PrototypeNotFoundError is only referenced
// via the Effect.catchTag tag literal above.
void PrototypeNotFoundError;
