/**
 * Type declaration for importing Markdown files as plain text strings.
 * Used with `import ... with { type: "text" }` in contexts.ts — supported in Node 22+
 * and handled by tsdown at bundle time.
 * At test time, .md files are transformed by rawMdPlugin in vite.config.ts.
 */
declare module "*.md" {
  const content: string;
  export default content;
}
