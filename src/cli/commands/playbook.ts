import { defineCommand } from "citty";
import { getPlaybook, listPlaybooks } from "#/lib/playbooks";

const listCommand = defineCommand({
  meta: { name: "list", description: "List available playbooks" },
  run: () => {
    const names = listPlaybooks();
    console.log("Available playbooks:");
    for (const name of names) {
      console.log(`  - ${name}`);
    }
    console.log("");
    console.log("Run `depot playbook <name>` to view a playbook.");
  },
});

// Build dynamic subcommands for each playbook
const subCommands: Record<string, ReturnType<typeof defineCommand>> = {
  list: listCommand,
};

for (const name of listPlaybooks()) {
  subCommands[name] = defineCommand({
    meta: { name, description: `Show the ${name} playbook` },
    run: () => {
      console.log(getPlaybook(name));
    },
  });
}

export const playbookCommand = defineCommand({
  meta: { name: "playbook", description: "View embedded agent playbooks" },
  subCommands,
});
