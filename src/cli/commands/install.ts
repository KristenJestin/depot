import fs from "node:fs/promises";
import { Schema } from "effect";
import { command } from "#/cli/command";
import { buildInstallWrites, resolveInstallTargets } from "#/modules/install/agent";

export const installCommand = command({
  meta: { name: "install", description: "Install depot slash commands for supported agents" },
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
    all: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Install commands for all supported agents",
    },
  },
  run: async ({ args, output }) => {
    let targets;

    try {
      targets = await resolveInstallTargets(
        {
          opencode: args.opencode,
          claudeCode: args["claude-code"],
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
      return output.error("install_error", error instanceof Error ? error.message : String(error));
    }

    const writes = buildInstallWrites(targets);
    for (const write of writes) {
      if (write.ensureDirectory) {
        await fs.mkdir(write.directory, { recursive: true });
      }
      await fs.writeFile(write.filePath, write.content, "utf-8");
      if (!output.isJson()) {
        output.print(`Wrote ${write.target} command ${write.mode}: ${write.filePath}`);
      }
    }

    if (output.isJson()) {
      output.success({
        items: writes.map((w) => ({ target: w.target, mode: w.mode, filePath: w.filePath })),
      });
    }
  },
});
