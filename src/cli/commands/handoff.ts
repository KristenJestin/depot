import { defineCommand } from "citty";
import { getDb } from "#/cli/context";
import { resolveWorkspace } from "#/lib/workflow";
import { buildHandoff } from "#/lib/handoff";

export const handoffCommand = defineCommand({
  meta: {
    name: "handoff",
    description: "Generate a structured handoff summary for the current workspace",
  },
  run: async () => {
    const db = await getDb();
    const cwd = process.cwd().replace(/\\/g, "/");
    const ws = await resolveWorkspace(db, cwd);
    if (!ws) {
      console.error("No workspace found for current directory. Run `depot init` first.");
      process.exit(1);
    }
    const output = await buildHandoff(db, ws.id);
    console.log(output);
  },
});
