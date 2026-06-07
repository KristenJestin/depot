import fs from "node:fs/promises";
import path from "node:path";

export type InstallTarget = "opencode" | "claude-code" | "codex";
export type InstallMode = "prd" | "dev" | "doc" | "ship";
export type CommandShell = "powershell" | "bash";

const MODE_DESCRIPTIONS: Record<InstallMode, string> = {
  prd: "Build a complete first-draft PRD from the code, then grill the user one question at a time until the spec is ready",
  dev: "Inject the live depot dev context for the current workspace",
  doc: "Sync the project docs based on a PRD, a time window, or since last sync. Free-text intent supported.",
  ship: "Wrap up a merged PRD — clean worktree, pull base, mark done, sync docs.",
};

const MODES_WITH_USER_INTENT: ReadonlySet<InstallMode> = new Set(["doc", "ship"]);

type ResolveInstallTargetsOptions = {
  homeDir?: string;
  existsSync?: (path: string) => boolean | Promise<boolean>;
};

export function getInstallDirectory(target: InstallTarget, homeDir: string): string {
  if (target === "opencode") {
    return path.join(homeDir, ".config", "opencode", "commands");
  }

  if (target === "claude-code") {
    return path.join(homeDir, ".claude", "commands");
  }

  return path.join(homeDir, ".agents", "skills");
}

export async function resolveInstallTargets(
  flags: { opencode?: boolean; claudeCode?: boolean; codex?: boolean; all?: boolean },
  options: ResolveInstallTargetsOptions = {},
): Promise<Array<{ target: InstallTarget; directory: string; ensureDirectory: boolean }>> {
  const homeDir = options.homeDir ?? getHomeDirectory();
  const existsCheck = options.existsSync ?? (() => false);
  const allTargets: InstallTarget[] = ["opencode", "claude-code", "codex"];

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
  if (flags.codex) {
    explicitTargets.push("codex");
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
      "No supported install directories found. Use --opencode, --claude-code, --codex, or --all to create them.",
    );
  }

  return detectedTargets;
}

export function buildCommandFileContent(target: InstallTarget, mode: InstallMode): string {
  if (target === "codex") {
    return buildCodexSkillContent(mode);
  }

  const description = MODE_DESCRIPTIONS[mode];
  const header = buildCommandHeader(target, description);
  const body =
    mode === "prd"
      ? buildPrdCommandBody(target)
      : mode === "dev"
        ? buildDevCommandBody(target)
        : buildIntentCommandBody(target, mode);

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
  kind: "command" | "skill";
  filePath: string;
  content: string;
}> {
  const modes: InstallMode[] = ["prd", "dev", "doc", "ship"];
  const writes: Array<{
    target: InstallTarget;
    directory: string;
    ensureDirectory: boolean;
    mode: InstallMode;
    kind: "command" | "skill";
    filePath: string;
    content: string;
  }> = [];

  for (const target of targets) {
    for (const mode of modes) {
      if (target.target === "codex") {
        const skillDirectory = path.join(target.directory, `depot-${mode}`);
        writes.push(
          {
            target: target.target,
            directory: skillDirectory,
            ensureDirectory: true,
            mode,
            kind: "skill",
            filePath: path.join(skillDirectory, "SKILL.md"),
            content: buildCommandFileContent(target.target, mode),
          },
          {
            target: target.target,
            directory: path.join(skillDirectory, "agents"),
            ensureDirectory: true,
            mode,
            kind: "skill",
            filePath: path.join(skillDirectory, "agents", "openai.yaml"),
            content: buildCodexSkillMetadata(mode),
          },
        );
        continue;
      }

      writes.push({
        target: target.target,
        directory: target.directory,
        ensureDirectory: target.ensureDirectory,
        mode,
        kind: "command",
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
    lines.push("disable-model-invocation: true");
  }

  lines.push("---");
  return lines.join("\n");
}

function buildCodexSkillContent(mode: InstallMode): string {
  const contextCommand = `depot context ${mode}`;
  const label = mode === "prd" ? "PRD" : "dev";
  const invocationHint =
    mode === "dev"
      ? ["If the user invoked `$depot-dev <prd-id>`, run `depot context dev <prd-id>` instead.", ""]
      : [];

  return [
    "---",
    `name: depot-${mode}`,
    `description: Load the live depot ${mode} context for the current workspace before ${mode === "prd" ? "framing PRD work" : "coordinating implementation work"}.`,
    "---",
    "",
    `Run \`${contextCommand}\` immediately and use its output as the working depot ${label} context for this session.`,
    "",
    ...invocationHint,
    `Do not rerun \`${contextCommand}\` unless the user explicitly asks for a refresh.`,
    "",
    "Follow the rendered depot instructions and preserve the current workspace state as the source of truth.",
  ].join("\n");
}

function buildCodexSkillMetadata(mode: InstallMode): string {
  const labelByMode: Record<InstallMode, string> = {
    prd: "Depot PRD",
    dev: "Depot Dev",
    doc: "Depot Doc",
    ship: "Depot Ship",
  };

  return [
    "interface:",
    `  display_name: "${labelByMode[mode]}"`,
    `  short_description: "Load live depot ${mode} context on demand"`,
    "policy:",
    "  allow_implicit_invocation: false",
  ].join("\n");
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
    "If the slash command was invoked with a PRD ID, that ID has already been forwarded to `depot context dev <prd-id>`.",
    "",
    "## Injected Context",
    contextBlock,
  ].join("\n");
}

function buildIntentCommandBody(target: InstallTarget, mode: InstallMode): string {
  const contextBlock = buildContextInjection(target, mode);
  const userIntentBlock = MODES_WITH_USER_INTENT.has(mode)
    ? ["## User intent", "$ARGUMENTS", ""].join("\n")
    : "";

  return [
    `Use the injected depot ${mode} context below as the working context for this session.`,
    "",
    `The command output has already been injected into this prompt. Do not rerun \`depot context ${mode}\` unless the user explicitly asks for a refresh.`,
    "",
    userIntentBlock,
    "## Injected Context",
    contextBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildContextInjection(target: InstallTarget, mode: InstallMode): string {
  if (mode === "dev") {
    return `!\`depot context dev $ARGUMENTS\``;
  }

  if (target === "opencode") {
    return `!\`depot context ${mode}\``;
  }

  return `!\`depot context ${mode}\``;
}

// ── Plugin + hook install ─────────────────────────────────────────────────────

export type PluginScope = "user" | "project";

/**
 * Resolve where the claude-code plugin should land.
 * - user scope (default): `~/.claude/plugins/depot/`
 * - project scope: `<cwd>/.claude/plugins/depot/`
 */
export function getPluginInstallDirectory(scope: PluginScope, homeDir?: string): string {
  const home = homeDir ?? getHomeDirectory();
  if (scope === "project") {
    return path.join(process.cwd(), ".claude", "plugins", "depot");
  }
  return path.join(home, ".claude", "plugins", "depot");
}

/**
 * Resolve the source dir to copy from. In dist (after `vp pack`) the plugin
 * lives at `dist/plugins/claude-code/depot`. In dev it lives at the repo's
 * `.claude/plugins/depot`. We try dist first, fall back to repo source.
 */
export function getPluginSourceDirectory(baseDir = import.meta.dirname): string {
  // After `vp pack`, `import.meta.dirname` resolves to `<repo>/dist/` because
  // the entry is bundled into `dist/index.mjs`. The plugin is shipped at
  // `dist/plugins/claude-code/depot` (see vite.config.ts onSuccess).
  // In tests / dev runs the module is at `src/modules/install/` and the
  // plugin source is the repo root's `.claude/plugins/depot`.
  const isDistRuntime = baseDir.endsWith(path.sep + "dist") || baseDir.endsWith("/dist");
  if (isDistRuntime) {
    return path.resolve(baseDir, "plugins", "claude-code", "depot");
  }
  return path.resolve(baseDir, "..", "..", "..", ".claude", "plugins", "depot");
}

export async function copyPluginToInstallDir(options: {
  source: string;
  target: string;
  copyFn?: (src: string, dst: string) => Promise<void>;
  chmodFn?: (p: string, mode: number) => Promise<void>;
  walkFn?: (dir: string) => Promise<string[]>;
}): Promise<{ filesWritten: string[]; chmodApplied: string[] }> {
  const copyFn = options.copyFn ?? defaultCopy;
  const chmodFn = options.chmodFn ?? fs.chmod;
  const walkFn = options.walkFn ?? defaultWalk;

  await fs.mkdir(options.target, { recursive: true });
  await copyFn(options.source, options.target);

  const filesWritten = await walkFn(options.target);
  const chmodApplied: string[] = [];
  for (const file of filesWritten) {
    if (file.endsWith(".sh")) {
      await chmodFn(file, 0o755);
      chmodApplied.push(file);
    }
  }
  return { filesWritten, chmodApplied };
}

async function defaultCopy(src: string, dst: string): Promise<void> {
  await fs.cp(src, dst, { recursive: true });
}

async function defaultWalk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await defaultWalk(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Build the SessionStart hook block that `--with-hooks` merges into
 * `~/.claude/settings.json`. The matcher targets every session start.
 */
export function buildSessionStartHookBlock(scriptPath: string): {
  SessionStart: Array<{
    matcher: string;
    hooks: Array<{ type: "command"; command: string }>;
  }>;
} {
  return {
    SessionStart: [
      {
        matcher: "*",
        hooks: [{ type: "command", command: scriptPath }],
      },
    ],
  };
}

/**
 * Merge our SessionStart hook into an existing `settings.json` payload
 * without dropping unrelated keys or other hook entries.
 */
export function mergeSettingsWithHook(
  existing: Record<string, unknown>,
  scriptPath: string,
): Record<string, unknown> {
  const next = { ...existing };
  const hooks = (next.hooks as Record<string, unknown> | undefined) ?? {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : [];
  const ourEntry = {
    matcher: "*",
    hooks: [{ type: "command", command: scriptPath }],
  };
  const alreadyInstalled = sessionStart.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      Array.isArray((entry as { hooks?: unknown[] }).hooks) &&
      (entry as { hooks: Array<{ command?: string }> }).hooks.some((h) => h.command === scriptPath),
  );
  if (!alreadyInstalled) sessionStart.push(ourEntry);
  next.hooks = { ...hooks, SessionStart: sessionStart };
  return next;
}

export function getHooksDirectory(homeDir?: string): string {
  return path.join(homeDir ?? getHomeDirectory(), ".claude", "hooks");
}

export function getSettingsPath(homeDir?: string): string {
  return path.join(homeDir ?? getHomeDirectory(), ".claude", "settings.json");
}

export const SESSION_START_HOOK_SCRIPT = `#!/usr/bin/env bash
# depot SessionStart hook — surface pending actions on session start.
# Best-effort: never fails the session.
set -e

if ! command -v depot >/dev/null 2>&1; then exit 0; fi
if ! command -v jq >/dev/null 2>&1; then exit 0; fi

OUTPUT="$(depot --json pending list --status pending 2>/dev/null || echo '{}')"
COUNT="$(echo "$OUTPUT" | jq '.items | length // 0' 2>/dev/null || echo 0)"
if [[ "\${COUNT:-0}" -eq 0 ]]; then exit 0; fi

echo "📥 depot has $COUNT pending action(s) for this project:"
echo "$OUTPUT" | jq -r '.items[] | "  [\\(.id)] \\(.humanReadableLabel) → \\(.slashCommand)"'
echo ""
echo "Run \\\`depot pending show <id>\\\` for details, or invoke the slash command directly."
`;
