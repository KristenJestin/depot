import type { TaskDescriptionFormat } from "#/lib/validator";

export type TaskDescriptionSection = {
  label: "Description" | "Intent" | "Scope" | "Non-goals";
  style: "text" | "list";
  lines: string[];
};

type StructuredSectionKey = "intent" | "scope" | "nonGoals";

const STRUCTURED_SECTION_MATCHERS: Array<{
  key: StructuredSectionKey;
  label: TaskDescriptionSection["label"];
  style: TaskDescriptionSection["style"];
  pattern: RegExp;
}> = [
  {
    key: "intent",
    label: "Intent",
    style: "text",
    pattern: /^intent\s*:\s*(.*)$/i,
  },
  {
    key: "scope",
    label: "Scope",
    style: "list",
    pattern: /^scope\s*:\s*(.*)$/i,
  },
  {
    key: "nonGoals",
    label: "Non-goals",
    style: "list",
    pattern: /^non(?:-|_|\s)goals\s*:\s*(.*)$/i,
  },
];

export function formatStructuredTaskDescription(input: {
  intent: string | string[];
  scope: string | string[];
  nonGoals: string | string[];
}): string {
  const lines: string[] = [];

  appendSection(lines, "Intent", normalizeTextInput(input.intent));
  appendSection(lines, "Scope", normalizeListInput(input.scope));
  appendSection(lines, "Non-goals", normalizeListInput(input.nonGoals));

  return lines.join("\n");
}

export function detectTaskDescriptionFormat(description: string): TaskDescriptionFormat {
  return hasStructuredTaskDescriptionHeadings(description) ? "structured_v1" : "legacy";
}

export function normalizeTaskDescriptionForStorage(
  description: string,
  descriptionFormat?: TaskDescriptionFormat,
): {
  description: string;
  descriptionFormat: TaskDescriptionFormat;
} {
  const normalizedDescription = description.trim();
  const resolvedFormat = descriptionFormat ?? detectTaskDescriptionFormat(normalizedDescription);

  if (resolvedFormat === "legacy") {
    return {
      description: normalizedDescription,
      descriptionFormat: resolvedFormat,
    };
  }

  const structuredSpec = extractStructuredTaskDescription(normalizedDescription);
  if (!structuredSpec) {
    throw new Error(
      "Structured task descriptions must include Intent, Scope, and Non-goals sections",
    );
  }

  return {
    description: formatStructuredTaskDescription(structuredSpec),
    descriptionFormat: resolvedFormat,
  };
}

export function getTaskDescriptionSections(
  description: string,
  descriptionFormat?: TaskDescriptionFormat | null,
): TaskDescriptionSection[] {
  const resolvedFormat =
    descriptionFormat === "structured_v1" ? descriptionFormat : detectTaskDescriptionFormat(description);
  if (resolvedFormat === "legacy") {
    return [
      {
        label: "Description",
        style: "text",
        lines: normalizeTextInput(description),
      },
    ];
  }

  const structuredSpec = extractStructuredTaskDescription(description);
  if (!structuredSpec) {
    return [
      {
        label: "Description",
        style: "text",
        lines: normalizeTextInput(description),
      },
    ];
  }

  return [
    {
      label: "Intent",
      style: "text",
      lines: structuredSpec.intent,
    },
    {
      label: "Scope",
      style: "list",
      lines: structuredSpec.scope,
    },
    {
      label: "Non-goals",
      style: "list",
      lines: structuredSpec.nonGoals,
    },
  ];
}

export function summarizeTaskDescription(
  description: string,
  descriptionFormat?: TaskDescriptionFormat | null,
): string {
  const sections = getTaskDescriptionSections(description, descriptionFormat);
  const preferredLabels: TaskDescriptionSection["label"][] = ["Intent", "Scope", "Description", "Non-goals"];

  for (const label of preferredLabels) {
    const section = sections.find((candidate) => candidate.label === label);
    const firstLine = section?.lines.find((line) => line.trim().length > 0);
    if (firstLine) {
      return firstLine;
    }
  }

  return "No task description recorded.";
}

type StructuredTaskDescription = {
  intent: string[];
  scope: string[];
  nonGoals: string[];
};

function extractStructuredTaskDescription(description: string): StructuredTaskDescription | null {
  const buckets: Record<StructuredSectionKey, string[]> = {
    intent: [],
    scope: [],
    nonGoals: [],
  };
  let currentSection: StructuredSectionKey | null = null;
  let isStructured = false;

  for (const rawLine of description.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const matchedSection = STRUCTURED_SECTION_MATCHERS.find(({ pattern }) => pattern.test(line));
    if (matchedSection) {
      isStructured = true;
      currentSection = matchedSection.key;
      const inlineValue = line.match(matchedSection.pattern)?.[1]?.trim() ?? "";
      if (inlineValue) {
        buckets[currentSection].push(normalizeSectionLine(matchedSection.style, inlineValue));
      }
      continue;
    }

    if (currentSection) {
      const section = STRUCTURED_SECTION_MATCHERS.find(({ key }) => key === currentSection)!;
      buckets[currentSection].push(normalizeSectionLine(section.style, line));
      continue;
    }
  }

  if (!isStructured || buckets.intent.length === 0 || buckets.scope.length === 0 || buckets.nonGoals.length === 0) {
    return null;
  }

  return buckets;
}

function appendSection(lines: string[], label: string, content: string[]): void {
  if (content.length === 0) {
    return;
  }

  if (lines.length > 0) {
    lines.push("");
  }

  lines.push(`${label}:`);
  lines.push(...content);
}

function normalizeTextInput(input: string | string[]): string[] {
  return normalizeInput(input).map(stripListMarker);
}

function normalizeListInput(input: string | string[]): string[] {
  return normalizeInput(input).map((line) => `- ${stripListMarker(line)}`);
}

function normalizeInput(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : input.split("\n");
  return values.map((line) => line.trim()).filter((line) => line.length > 0);
}

function normalizeSectionLine(style: TaskDescriptionSection["style"], line: string): string {
  return style === "list" ? stripListMarker(line) : line;
}

function stripListMarker(line: string): string {
  return line.replace(/^[-*]\s+/, "").trim();
}

function hasStructuredTaskDescriptionHeadings(description: string): boolean {
  return description
    .split("\n")
    .map((line) => line.trim())
    .some((line) => STRUCTURED_SECTION_MATCHERS.some(({ pattern }) => pattern.test(line)));
}
