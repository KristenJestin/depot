import type { ReactNode } from "react";

type Props = {
  source: string;
  className?: string;
};

/**
 * Minimal Markdown renderer for stored PRD/task fields. Supports:
 * - paragraphs (blank-line separated)
 * - bullet lists with `- ` or `* `
 * - ordered lists `1. `
 * - headings `#` to `######`
 * - fenced code blocks ` ``` `
 * - inline `code`, **bold**, *italic*, [text](url)
 *
 * Intentionally skips raw HTML, tables, and nested-list edge cases.
 */
export function Markdown({ source, className }: Props) {
  const blocks = parseBlocks(source ?? "");
  return <div className={className}>{blocks.map((block, i) => renderBlock(block, i))}</div>;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang: string; lines: string[] };

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim().length === 0) {
      i++;
      continue;
    }

    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i++;
      }
      i++;
      blocks.push({ kind: "code", lang, lines: code });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1]!.length, text: heading[2]!.trim() });
      i++;
      continue;
    }

    const ulMatch = /^[-*]\s+(.+)$/.exec(line.trim());
    if (ulMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? "").trim();
        const m = /^[-*]\s+(.+)$/.exec(t);
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    const olMatch = /^\d+[.)]\s+(.+)$/.exec(line.trim());
    if (olMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? "").trim();
        const m = /^\d+[.)]\s+(.+)$/.exec(t);
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const t = (lines[i] ?? "").trim();
      if (t.length === 0) break;
      if (/^[-*]\s+/.test(t) || /^\d+[.)]\s+/.test(t) || /^#{1,6}\s+/.test(t) || /^```/.test(t))
        break;
      para.push(lines[i] ?? "");
      i++;
    }
    blocks.push({ kind: "p", lines: para });
  }

  return blocks;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "p":
      return (
        <p key={key} className="my-2 leading-6">
          {renderInline(block.lines.join(" "))}
        </p>
      );
    case "h": {
      const cls =
        block.level === 1
          ? "text-xl font-semibold mt-3 mb-2"
          : block.level === 2
            ? "text-lg font-semibold mt-3 mb-2"
            : "text-base font-semibold mt-2 mb-1";
      const Tag = `h${block.level}` as unknown as "h1";
      return (
        <Tag key={key} className={cls}>
          {renderInline(block.text)}
        </Tag>
      );
    }
    case "ul":
      return (
        <ul key={key} className="my-2 ml-5 list-disc space-y-1">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="my-2 ml-5 list-decimal space-y-1">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre
          key={key}
          className="my-2 rounded bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap"
        >
          <code>{block.lines.join("\n")}</code>
        </pre>
      );
  }
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/;
  while (remaining.length > 0) {
    const match = pattern.exec(remaining);
    if (!match) {
      parts.push(remaining);
      break;
    }
    if (match.index > 0) {
      parts.push(remaining.slice(0, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      parts.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        parts.push(
          <a
            key={key++}
            href={linkMatch[2]!}
            className="text-primary underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        parts.push(token);
      }
    } else {
      parts.push(token);
    }
    remaining = remaining.slice(match.index + token.length);
  }
  return parts;
}
