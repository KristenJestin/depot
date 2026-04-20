export function normalizeWorkspacePath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
