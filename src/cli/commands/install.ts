import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { defineValidatedCommand } from "#/cli/command";
import { buildInstallWrites, resolveInstallTargets } from "#/lib/agent-install";
import * as z from "zod";

const installArgsSchema = z.object({
  opencode: z.boolean().default(false),
  "claude-code": z.boolean().default(false),
  all: z.boolean().default(false),
});

export const installCommand = defineValidatedCommand({
  schema: installArgsSchema,
  meta: { name: "install", description: "Install depot slash commands for supported agents" },
  args: {
    opencode: {
      type: "boolean",
      description: "Install OpenCode commands",
      default: false,
    },
    "claude-code": {
      type: "boolean",
      description: "Install Claude Code commands",
      default: false,
    },
    all: {
      type: "boolean",
      description: "Install commands for all supported agents",
      default: false,
    },
  },
  run: async ({ args }) => {
    let targets;

    try {
      targets = resolveInstallTargets(
        {
          opencode: args.opencode,
          claudeCode: args["claude-code"],
          all: args.all,
        },
        {
          existsSync,
        },
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    const writes = buildInstallWrites(targets);
    for (const write of writes) {
      if (write.ensureDirectory) {
        await fs.mkdir(write.directory, { recursive: true });
      }
      await fs.writeFile(write.filePath, write.content, "utf-8");
      console.log(`Wrote ${write.target} command ${write.mode}: ${write.filePath}`);
    }
  },
});
