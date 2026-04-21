import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { formatStructuredTaskDescription } from "#/lib/task-spec";
import {
  addWorkspace,
  commitPrd,
  createPrd,
  createProject,
  createTask,
  listTasks,
  listActivity,
} from "#/lib/workflow";
import { setJsonMode } from "#/lib/logger";

const resolveCurrentWorkspace = vi.fn<() => Promise<{ db: Database; ws: unknown }>>();

vi.mock("#/cli/runtime", () => ({
  resolveCurrentWorkspace,
}));

type RunnableSubCommand = {
  run: (ctx: { args: Record<string, unknown> }) => Promise<void> | void;
};

async function getSubCommand(command: { subCommands?: unknown }, name: string) {
  const subCommands = await command.subCommands;
  if (!subCommands || typeof subCommands !== "object" || !(name in subCommands)) {
    throw new Error(`Subcommand not found: ${name}`);
  }
  return (subCommands as Record<string, RunnableSubCommand>)[name]!;
}

/**
 * Capture all process.stdout.write calls during fn() and return the
 * concatenated output as a string.
 */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    if (typeof chunk === "string") chunks.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join("");
}

describe("CLI commands", () => {
  let db: Database;
  let projectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());

    const project = await createProject(db, { name: "cli-project" });
    projectId = project.id;

    const workspace = await addWorkspace(db, {
      projectId,
      path: "/workspace/cli-project",
    });
    workspaceId = workspace.id;

    resolveCurrentWorkspace.mockResolvedValue({
      db,
      ws: workspace,
    });
  });

  afterEach(() => {
    setJsonMode(false);
  });

  it("task add requires full PRD IDs and full dependency IDs", async () => {
    const { taskCommand } = await import("#/cli/commands/task");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "CLI PRD",
    });
    await commitPrd(db, prd.id);

    const dependency = await createTask(db, {
      prdId: prd.id,
      title: "Dependency",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await addCommand.run({
      args: {
        prd: prd.id,
        title: "Dependent task",
        desc: formatStructuredTaskDescription({
          intent: "Create a dependent task.",
          scope: "Link the dependency to the new task.",
          nonGoals: "Do not change dependency resolution behavior.",
        }),
        criteria: "done",
        effort: "m",
        depends: dependency.id,
      },
    });

    const tasks = await (await import("#/lib/workflow")).listTasks(db, prd.id);
    const created = tasks.find((task) => task.title === "Dependent task");

    expect(created).toBeTruthy();
    expect(JSON.parse(created!.dependsOn)).toEqual([dependency.id]);
    expect(created!.descriptionFormat).toBe("structured_v1");

    stdout.mockRestore();
  });

  it("task add rejects legacy task descriptions", async () => {
    const { taskCommand } = await import("#/cli/commands/task");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "CLI PRD",
    });

    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    await expect(
      addCommand.run({
        args: {
          prd: prd.id,
          title: "Legacy task",
          desc: "Plain legacy description",
          criteria: "done",
          effort: "m",
        },
      }),
    ).rejects.toThrow("process.exit:1");

    expect(await listTasks(db, prd.id)).toHaveLength(0);

    exit.mockRestore();
  });

  it("task add stores structured task descriptions explicitly", async () => {
    const { taskCommand } = await import("#/cli/commands/task");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "CLI PRD",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await addCommand.run({
      args: {
        prd: prd.id,
        title: "Structured task",
        desc: formatStructuredTaskDescription({
          intent: "Clarify the implementation intent.",
          scope: ["Render structured sections", "Preserve legacy readability"],
          nonGoals: "Do not require legacy task rewrites",
        }),
        criteria: "Structured output is readable",
        effort: "m",
      },
    });

    const [created] = await listTasks(db, prd.id);
    expect(created).toBeTruthy();
    expect(created!.descriptionFormat).toBe("structured_v1");
    expect(created!.description).toContain("Intent:");
    expect(created!.description).toContain("- Render structured sections");

    stdout.mockRestore();
  });

  it("task list requires full PRD IDs", async () => {
    const { taskCommand } = await import("#/cli/commands/task");
    const listCommand = await getSubCommand(taskCommand, "list");

    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "CLI PRD",
    });
    await commitPrd(db, prd.id);
    await createTask(db, {
      prdId: prd.id,
      title: "Listed task",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await listCommand.run({
      args: {
        prdId: prd.id,
      },
    });

    const lines = stdout.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("Listed task"))).toBe(true);

    stdout.mockRestore();
  });

  it("task list prints full task IDs", async () => {
    const { taskCommand } = await import("#/cli/commands/task");
    const listCommand = await getSubCommand(taskCommand, "list");

    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "CLI PRD",
    });
    await commitPrd(db, prd.id);

    await createTask(db, {
      prdId: prd.id,
      title: "Task A",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });
    await createTask(db, {
      prdId: prd.id,
      title: "Task B",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await listCommand.run({
      args: {
        prdId: prd.id,
      },
    });

    const tasks = await listTasks(db, prd.id);
    const lines = stdout.mock.calls.map((call) => String(call[0]));
    for (const task of tasks) {
      expect(lines.some((line) => line.startsWith(task.id))).toBe(true);
    }

    stdout.mockRestore();
  });

  it("log add requires full PRD and task IDs", async () => {
    const { logCommand } = await import("#/cli/commands/log");
    const addCommand = await getSubCommand(logCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "CLI PRD",
    });
    const task = await createTask(db, {
      prdId: prd.id,
      title: "Task for log",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await addCommand.run({
      args: {
        eventType: "note",
        prd: prd.id,
        task: task.id,
        payload: '{"message":"hello"}',
      },
    });

    const entries = await listActivity(db, { projectId, workspaceId });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.prdId).toBe(prd.id);
    expect(entries[0]!.taskId).toBe(task.id);

    stdout.mockRestore();
  });

  it("log add accepts PowerShell-mangled payload objects", async () => {
    const { logCommand } = await import("#/cli/commands/log");
    const addCommand = await getSubCommand(logCommand, "add");

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await addCommand.run({
      args: {
        eventType: "note",
        payload: "{message:hello,count:1}",
      },
    });

    const entries = await listActivity(db, { projectId, workspaceId });
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0]!.payload)).toEqual({ message: "hello", count: 1 });

    stdout.mockRestore();
  });

  it("task show renders structured task descriptions section by section", async () => {
    const { taskCommand } = await import("#/cli/commands/task");
    const showCommand = await getSubCommand(taskCommand, "show");

    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "CLI PRD",
    });

    const task = await createTask(db, {
      prdId: prd.id,
      title: "Structured task",
      description: formatStructuredTaskDescription({
        intent: "Clarify the implementation intent.",
        scope: ["Render structured sections", "Preserve legacy readability"],
        nonGoals: "Do not require legacy task rewrites",
      }),
      doneCriteria: "Structured output is readable\nLegacy output still works",
      effort: "m",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await showCommand.run({
      args: {
        taskId: task.id,
      },
    });

    const lines = stdout.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain("Intent      : Clarify the implementation intent.");
    expect(lines).toContain("Scope       : - Render structured sections");
    expect(lines.some((line) => line.trim() === "- Preserve legacy readability")).toBe(true);
    expect(lines).toContain("Non-goals   : - Do not require legacy task rewrites");
    expect(lines).toContain("Criteria    : - Structured output is readable");
    expect(lines.some((line) => line.trim() === "- Legacy output still works")).toBe(true);

    stdout.mockRestore();
  });

  it("context mode renders only the requested mode", async () => {
    const { contextCommand } = await import("#/cli/commands/context");
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "CLI PRD",
    });
    await commitPrd(db, prd.id);

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await contextCommand.run?.({
      rawArgs: [],
      args: {
        _: [],
        mode: "prd" as never,
        prdTarget: undefined as never,
      },
      cmd: contextCommand,
    });

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(String(stdout.mock.calls[0]?.[0])).toContain("=== DEPOT CONTEXT — PRD ===");
    expect(String(stdout.mock.calls[0]?.[0])).not.toContain("=== DEPOT CONTEXT — CONTEXT ===");

    stdout.mockRestore();
  });

  // ── JSON mode tests ───────────────────────────────────────────────────────

  describe("--json mode", () => {
    beforeEach(() => {
      setJsonMode(true);
    });

    it("prd list emits a success envelope with items array", async () => {
      const { prdCommand } = await import("#/cli/commands/prd");
      const listCommand = await getSubCommand(prdCommand, "list");

      await createPrd(db, { projectId, workspaceId, title: "PRD Alpha" });
      await createPrd(db, { projectId, workspaceId, title: "PRD Beta" });

      const output = await captureStdout(async () => {
        await listCommand.run({ args: {} });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(Array.isArray(parsed.payload.items)).toBe(true);
      expect(parsed.payload.items).toHaveLength(2);
      expect(parsed.payload.items[0].title).toBeTruthy();
    });

    it("prd create emits a success envelope with item", async () => {
      const { prdCommand } = await import("#/cli/commands/prd");
      const createCommand = await getSubCommand(prdCommand, "create");

      const output = await captureStdout(async () => {
        await createCommand.run({
          args: { title: "New PRD", context: "why", scope: "what" },
        });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(parsed.payload.item.title).toBe("New PRD");
      expect(parsed.payload.item.status).toBe("draft");
    });

    it("prd show emits not_found error envelope for missing PRD", async () => {
      const { prdCommand } = await import("#/cli/commands/prd");
      const showCommand = await getSubCommand(prdCommand, "show");

      const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      const output = await captureStdout(async () => {
        await expect(
          showCommand.run({ args: { prdId: "NONEXISTENT" } }),
        ).rejects.toThrow("process.exit:1");
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("error");
      expect(parsed.error.code).toBe("not_found");

      exit.mockRestore();
    });

    it("task list emits success envelope with items and parsed dependsOn arrays", async () => {
      const { taskCommand } = await import("#/cli/commands/task");
      const listCmd = await getSubCommand(taskCommand, "list");

      const prd = await createPrd(db, { projectId, workspaceId, title: "JSON PRD" });
      await commitPrd(db, prd.id);

      const dep = await createTask(db, {
        prdId: prd.id,
        title: "Dep task",
        description: "d",
        doneCriteria: "c",
        effort: "s",
      });
      await createTask(db, {
        prdId: prd.id,
        title: "Main task",
        description: "d",
        doneCriteria: "c",
        effort: "m",
        dependsOn: [dep.id],
      });

      const output = await captureStdout(async () => {
        await listCmd.run({ args: { prdId: prd.id } });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(Array.isArray(parsed.payload.items)).toBe(true);
      expect(parsed.payload.items).toHaveLength(2);
      // dependsOn must be a parsed array, not a JSON string
      for (const item of parsed.payload.items) {
        expect(Array.isArray(item.dependsOn)).toBe(true);
      }
      const mainTask = parsed.payload.items.find((t: { title: string }) => t.title === "Main task");
      expect(mainTask.dependsOn).toEqual([dep.id]);
    });

    it("task add emits success envelope with the created task", async () => {
      const { taskCommand } = await import("#/cli/commands/task");
      const addCmd = await getSubCommand(taskCommand, "add");

      const prd = await createPrd(db, { projectId, workspaceId, title: "JSON PRD" });
      await commitPrd(db, prd.id);

      const output = await captureStdout(async () => {
        await addCmd.run({
          args: {
            prd: prd.id,
            title: "JSON task",
            desc: formatStructuredTaskDescription({
              intent: "Test JSON output.",
              scope: "Cover the add command.",
              nonGoals: "Not a full integration test.",
            }),
            criteria: "emits JSON",
            effort: "s",
          },
        });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(parsed.payload.item.title).toBe("JSON task");
      expect(Array.isArray(parsed.payload.item.dependsOn)).toBe(true);
    });

    it("log list emits success envelope with parsed payload objects", async () => {
      const { logCommand } = await import("#/cli/commands/log");
      const addCmd = await getSubCommand(logCommand, "add");
      const listCmd = await getSubCommand(logCommand, "list");

      // Add an entry in text mode, then list in JSON mode
      setJsonMode(false);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await addCmd.run({
        args: { eventType: "note", payload: '{"message":"hello"}' },
      });
      consoleSpy.mockRestore();
      setJsonMode(true);

      const output = await captureStdout(async () => {
        await listCmd.run({ args: { last: "20" } });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(Array.isArray(parsed.payload.items)).toBe(true);
      // payload must be a parsed object, not a JSON string
      for (const item of parsed.payload.items) {
        expect(typeof item.payload).toBe("object");
        expect(item.payload).not.toBeNull();
      }
    });

    it("stdout stays pure JSON with no extra text in JSON mode", async () => {
      const { prdCommand } = await import("#/cli/commands/prd");
      const listCommand = await getSubCommand(prdCommand, "list");

      const output = await captureStdout(async () => {
        await listCommand.run({ args: {} });
      });

      // Must be valid JSON and nothing else
      const trimmed = output.trim();
      expect(() => JSON.parse(trimmed)).not.toThrow();
      // No extra newlines before or after the JSON envelope
      expect(trimmed).toBe(JSON.stringify(JSON.parse(trimmed)));
    });

    it("context command emits unsupported error in JSON mode", async () => {
      const { contextCommand } = await import("#/cli/commands/context");

      const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      const output = await captureStdout(async () => {
        await expect(
          contextCommand.run?.({
            rawArgs: [],
            args: { _: [], mode: undefined as never, prdTarget: undefined as never },
            cmd: contextCommand,
          }),
        ).rejects.toThrow("process.exit:1");
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("error");
      expect(parsed.error.code).toBe("unsupported");

      exit.mockRestore();
    });
  });
});
