import fs from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import { command } from "#/cli/command";
import {
  buildInstallWrites,
  copyPluginToInstallDir,
  getHooksDirectory,
  getPluginInstallDirectory,
  getPluginSourceDirectory,
  getSettingsPath,
  mergeSettingsWithHook,
  resolveInstallTargets,
  SESSION_START_HOOK_SCRIPT,
} from "#/modules/install/agent";

export const installCommand = command({
  meta: { name: "install", description: "Install depot agent integrations for supported tools" },
  args: {
    opencode: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Install OpenCode commands",
    },
    "claude-code": {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Install Claude Code commands",
    },
    codex: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Install Codex skills",
    },
    all: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Install integrations for all supported agents",
    },
    "claude-code-plugin": {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description:
        "Install the claude-code plugin (hooks for Edit/Write/Bash/Read/Grep/Glob and tool failures)",
    },
    "with-hooks": {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description:
        "Install a standalone SessionStart hook (~/.claude/hooks/depot-session-start.sh) that surfaces pending actions",
    },
    "plugin-scope": {
      schema: Schema.Literal("user", "project"),
      default: "user",
      description:
        "Where to install the plugin (user: ~/.claude/plugins, project: ./.claude/plugins)",
    },
  },
  run: async ({ args, output }) => {
    const wroteSomething: string[] = [];
    let pluginRoot: string | null = null;
    let hookScriptPath: string | null = null;

    // Preserve the existing command-file install behavior when no hook-only
    // target is requested.
    const wantsCommands =
      args.opencode ||
      args["claude-code"] ||
      args.codex ||
      args.all ||
      // No specific target flag and no plugin/hook flag → auto-detect commands
      (!args["claude-code-plugin"] && !args["with-hooks"]);
    if (wantsCommands) {
      let targets: Awaited<ReturnType<typeof resolveInstallTargets>>;
      try {
        targets = await resolveInstallTargets(
          {
            opencode: args.opencode,
            claudeCode: args["claude-code"],
            codex: args.codex,
            all: args.all,
          },
          {
            existsSync: (p) =>
              fs.access(p).then(
                () => true,
                () => false,
              ),
          },
        );
      } catch (error) {
        if (!args["claude-code-plugin"] && !args["with-hooks"]) {
          return output.error(
            "install_error",
            error instanceof Error ? error.message : String(error),
          );
        }
        targets = [];
      }

      const writes = buildInstallWrites(targets);
      for (const write of writes) {
        if (write.ensureDirectory) {
          await fs.mkdir(write.directory, { recursive: true });
        }
        await fs.writeFile(write.filePath, write.content, "utf-8");
        wroteSomething.push(write.filePath);
        if (!output.isJson()) {
          output.print(`Wrote ${write.target} ${write.kind} ${write.mode}: ${write.filePath}`);
        }
      }
    }

    // Install the claude-code plugin when requested.
    if (args["claude-code-plugin"]) {
      const target = getPluginInstallDirectory(args["plugin-scope"]);
      const source = getPluginSourceDirectory();
      try {
        const { filesWritten, chmodApplied } = await copyPluginToInstallDir({
          source,
          target,
        });
        pluginRoot = target;
        wroteSomething.push(...filesWritten);
        if (!output.isJson()) {
          output.print(`Installed plugin to ${target} (${filesWritten.length} files).`);
          output.print(`Chmod +x applied to: ${chmodApplied.length} shell scripts.`);
          output.print(`Restart your claude-code session to activate.`);
        }
      } catch (e) {
        return output.error("plugin_install_failed", e instanceof Error ? e.message : String(e));
      }
    }

    // Install the standalone SessionStart hook when requested.
    if (args["with-hooks"]) {
      const hooksDir = getHooksDirectory();
      const scriptPath = path.join(hooksDir, "depot-session-start.sh");
      const settingsPath = getSettingsPath();
      try {
        await fs.mkdir(hooksDir, { recursive: true });
        await fs.writeFile(scriptPath, SESSION_START_HOOK_SCRIPT, "utf-8");
        await fs.chmod(scriptPath, 0o755);

        let existing: Record<string, unknown> = {};
        try {
          const raw = await fs.readFile(settingsPath, "utf-8");
          existing = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // settings.json may not exist yet; that's fine
        }
        const merged = mergeSettingsWithHook(existing, scriptPath);
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2), "utf-8");

        hookScriptPath = scriptPath;
        wroteSomething.push(scriptPath, settingsPath);
        if (!output.isJson()) {
          output.print(`Installed SessionStart hook: ${scriptPath}`);
          output.print(`Updated settings: ${settingsPath}`);
        }
      } catch (e) {
        return output.error("hook_install_failed", e instanceof Error ? e.message : String(e));
      }
    }

    if (output.isJson()) {
      output.success({
        files: wroteSomething,
        pluginRoot,
        hookScriptPath,
      });
    }
  },
});
