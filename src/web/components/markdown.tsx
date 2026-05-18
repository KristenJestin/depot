import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "#/web/lib/utils";

type Props = {
  source: string;
  className?: string;
};

/**
 * Markdown renderer for stored PRD/task fields.
 *
 * Wraps `react-markdown` with `remark-gfm` (tables, strikethrough, autolinks,
 * task lists) and styles output through `@tailwindcss/typography` (`prose`).
 * Inner element colours inherit from the wrapper so callers can drive the
 * text colour by passing a `text-*` class on `className`.
 */
export function Markdown({ source, className }: Props) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none",
        "prose-headings:text-current prose-headings:font-semibold",
        "prose-p:text-current prose-li:text-current prose-strong:text-current",
        "prose-blockquote:text-current prose-blockquote:border-card-border",
        "prose-code:text-current prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted/40 prose-pre:text-current",
        "prose-a:text-primary",
        "prose-th:border prose-th:border-card-border prose-th:px-2 prose-th:py-1 prose-th:text-current",
        "prose-td:border prose-td:border-card-border prose-td:px-2 prose-td:py-1 prose-td:text-current",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a {...props} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {source ?? ""}
      </ReactMarkdown>
    </div>
  );
}
