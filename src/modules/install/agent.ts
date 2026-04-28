import path from "node:path";

export type InstallTarget = "opencode" | "claude-code";
export type InstallMode = "prd" | "dev";
export type CommandShell = "powershell" | "bash";

type ResolveInstallTargetsOptions = {
  homeDir?: string;
  existsSync?: (path: string) => boolean | Promise<boolean>;
};

export function getInstallDirectory(target: InstallTarget, homeDir: string): string {
  if (target === "opencode") {
    return path.join(homeDir, ".config", "opencode", "commands");
  }

  return path.join(homeDir, ".claude", "commands");
}

export async function resolveInstallTargets(
  flags: { opencode?: boolean; claudeCode?: boolean; all?: boolean },
  options: ResolveInstallTargetsOptions = {},
): Promise<Array<{ target: InstallTarget; directory: string; ensureDirectory: boolean }>> {
  const homeDir = options.homeDir ?? getHomeDirectory();
  const existsCheck = options.existsSync ?? (() => false);
  const allTargets: InstallTarget[] = ["opencode", "claude-code"];

  if (flags.all) {
    return allTargets.map((target) => ({
      target,
      directory: getInstallDirectory(target, homeDir),
      ensureDirectory: true,
    }));
  }

  const explicitTargets: InstallTarget[] = [];
  if (flags.opencode) {
    explicitTargets.push("opencode");
  }
  if (flags.claudeCode) {
    explicitTargets.push("claude-code");
  }

  if (explicitTargets.length > 0) {
    return explicitTargets.map((target) => ({
      target,
      directory: getInstallDirectory(target, homeDir),
      ensureDirectory: true,
    }));
  }

  const candidates = allTargets.map((target) => ({
    target,
    directory: getInstallDirectory(target, homeDir),
    ensureDirectory: false,
  }));
  const results = await Promise.all(candidates.map((t) => existsCheck(t.directory)));
  const detectedTargets = candidates.filter((_, i) => results[i]);

  if (detectedTargets.length === 0) {
    throw new Error(
      "No supported command directories found. Use --opencode, --claude-code, or --all to create them.",
    );
  }

  return detectedTargets;
}

export function buildCommandFileContent(target: InstallTarget, mode: InstallMode): string {
  const description = `Inject the live depot ${mode} context for the current workspace`;
  const header = buildCommandHeader(target, description);
  const body = mode === "prd" ? buildPrdCommandBody(target) : buildDevCommandBody(target);

  return [header, body, ""].join("\n");
}

export function detectCommandShell(platform: NodeJS.Platform = process.platform): CommandShell {
  return platform === "win32" ? "powershell" : "bash";
}

export function buildInstallWrites(
  targets: Array<{ target: InstallTarget; directory: string; ensureDirectory: boolean }>,
): Array<{
  target: InstallTarget;
  directory: string;
  ensureDirectory: boolean;
  mode: InstallMode;
  filePath: string;
  content: string;
}> {
  const modes: InstallMode[] = ["prd", "dev"];
  const writes: Array<{
    target: InstallTarget;
    directory: string;
    ensureDirectory: boolean;
    mode: InstallMode;
    filePath: string;
    content: string;
  }> = [];

  for (const target of targets) {
    for (const mode of modes) {
      writes.push({
        target: target.target,
        directory: target.directory,
        ensureDirectory: target.ensureDirectory,
        mode,
        filePath: path.join(target.directory, `depot-${mode}.md`),
        content: buildCommandFileContent(target.target, mode),
      });
    }
  }

  return writes;
}

function getHomeDirectory(): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!homeDir) {
    throw new Error("Could not determine the current home directory.");
  }

  return homeDir;
}

function buildCommandHeader(target: InstallTarget, description: string): string {
  const lines = ["---", `description: ${description}`];

  if (target === "claude-code") {
    lines.push("disable-model-invocation: true", "shell: powershell");
  }

  lines.push("---");
  return lines.join("\n");
}

function buildPrdCommandBody(target: InstallTarget): string {
  const contextBlock = buildContextInjection(target, "prd");

  return [
    "Use the injected depot PRD context below as the working context for this session.",
    "",
    "The command output has already been injected into this prompt. Do not rerun `depot context prd` unless the user explicitly asks for a refresh.",
    "",
    "## Injected Context",
    contextBlock,
  ].join("\n");
}

function buildDevCommandBody(target: InstallTarget): string {
  const contextBlock = buildContextInjection(target, "dev");

  return [
    "Use the injected depot dev context below as the working context for this session.",
    "",
    "The command output has already been injected into this prompt. Do not rerun `depot context dev` unless the user explicitly asks for a refresh.",
    "",
    "## Injected Context",
    contextBlock,
  ].join("\n");
}

function buildContextInjection(target: InstallTarget, mode: InstallMode): string {
  if (target === "opencode") {
    return `!\`depot context ${mode}\``;
  }

  return `!\`depot context ${mode}\``;
}
