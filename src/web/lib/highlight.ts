import { createHighlighter, type BundledLanguage, type Highlighter } from "shiki/bundle/web";

/**
 * Singleton shiki highlighter loaded lazily on first use. Bundled-web build
 * keeps the import size manageable. Themes match our token palette (dark by
 * default; web UI is dark-oriented).
 */
let highlighterPromise: Promise<Highlighter> | null = null;

const LOADED_LANGUAGES = new Set<string>();

const EXTENSION_TO_LANGUAGE: Record<string, BundledLanguage> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  md: "md",
  mdx: "mdx",
  py: "python",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  php: "php",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  html: "html",
  css: "css",
  scss: "scss",
  vue: "vue",
  svelte: "svelte",
};

function languageForPath(path: string): BundledLanguage | "text" {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  if (!m) return "text";
  const ext = m[1]!.toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? "text";
}

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark-dimmed"],
      langs: ["ts", "tsx", "js", "jsx"],
    });
  }
  return highlighterPromise;
}

/**
 * Tokenize a single line as HTML for the given file path. Falls back to
 * a plain text span when the language is unknown or shiki isn't ready.
 */
export async function highlightLine(line: string, path: string): Promise<string> {
  const lang = languageForPath(path);
  if (lang === "text") return escapeHtml(line);

  try {
    const hl = await getHighlighter();
    if (!LOADED_LANGUAGES.has(lang)) {
      await hl.loadLanguage(lang);
      LOADED_LANGUAGES.add(lang);
    }
    const html = hl.codeToHtml(line, { lang, theme: "github-dark-dimmed" });
    // shiki wraps in <pre><code>; extract just the inner spans of the first
    // (and only) line.
    const match = html.match(/<code[^>]*>(.+?)<\/code>/s);
    if (!match) return escapeHtml(line);
    const inner = match[1]!.replace(/<\/?span[^>]*class="line"[^>]*>/g, "");
    return inner;
  } catch {
    return escapeHtml(line);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isSupportedLanguage(path: string): boolean {
  return languageForPath(path) !== "text";
}
