/**
 * Type declaration for importing Markdown files as plain text strings.
 * Used with Bun's `with { type: "text" }` import attribute in contexts.ts.
 * Vitest handles .md files via the rawMdPlugin in vitest.config.ts.
 */
declare module "*.md" {
  const content: string;
  export default content;
}
