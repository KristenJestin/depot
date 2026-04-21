import path from "node:path";

export type InstallTarget = "opencode" | "claude-code";
export type InstallMode = "prd" | "dev" | "review";
export type CommandShell = "powershell" | "bash";

type ResolveInstallTargetsOptions = {
  homeDir?: string;
  existsSync?: (filePath: string) => boolean;
};

export function getInstallDirectory(target: InstallTarget, homeDir: string): string {
  if (target === "opencode") {
    return path.join(homeDir, ".config", "opencode", "commands");
  }

  return path.join(homeDir, ".claude", "commands");
}

export function resolveInstallTargets(
  flags: { opencode?: boolean; claudeCode?: boolean; all?: boolean },
  options: ResolveInstallTargetsOptions = {},
): Array<{ target: InstallTarget; directory: string; ensureDirectory: boolean }> {
  const homeDir = options.homeDir ?? getHomeDirectory();
  const existsSync = options.existsSync ?? (() => false);
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

  const detectedTargets = allTargets
    .map((target) => ({
      target,
      directory: getInstallDirectory(target, homeDir),
      ensureDirectory: false,
    }))
    .filter((target) => existsSync(target.directory));

  if (detectedTargets.length === 0) {
    throw new Error(
      "No supported command directories found. Use --opencode, --claude-code, or --all to create them.",
    );
  }

  return detectedTargets;
}

export function buildCommandFileContent(target: InstallTarget, mode: InstallMode): string {
  const title = mode.toUpperCase();
  const description = `Inject the live depot ${mode} context for the current workspace`;
  const sharedBody = [`Use the live depot ${title} context for this workspace.`, "", `!\`depot context ${mode}\``].join("\n");

  if (target === "opencode") {
    return [`---`, `description: ${description}`, `---`, sharedBody, ""].join("\n");
  }

  return [
    `---`,
    `description: ${description}`,
    `disable-model-invocation: true`,
    `shell: ${detectCommandShell()}`,
    `---`,
    sharedBody,
    "",
  ].join("\n");
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
  const modes: InstallMode[] = ["prd", "dev", "review"];
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
