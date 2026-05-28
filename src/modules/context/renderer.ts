import { Effect } from "effect";
import { listDirectives } from "#/modules/projects/directives";
import { Db } from "#/services/database";
import { DatabaseError } from "#/shared/errors";
import {
  VALID_DIRECTIVE_CATEGORIES,
  VALID_DIRECTIVE_SCOPES,
  isValidCategoryScope,
} from "#/shared/validator";
import type { DirectiveCategory, DirectiveScope } from "#/shared/validator";
import type { ProjectDirectiveRow } from "#/db/schema";

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
    if (matches.length === 0) return line;

    let out = "";
    let cursor = 0;
    for (const match of matches) {
      const start = match.index ?? 0;
      out += line.slice(cursor, start);
      const raw = match[0];
      const marker = parseMarker(raw);
      if (!marker) {
        out += raw;
      } else {
        const directives = yield* listDirectives(projectId, {
          scope: marker.scope,
          category: marker.category,
          enabledOnly: true,
        });
        out += renderMarker(marker, directives);
      }
      cursor = start + raw.length;
    }
    out += line.slice(cursor);
    return out;
  });
