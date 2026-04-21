import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import {
  addWorkspace,
  commitPrd,
  createPrd,
  createProject,
  createTask,
  listTasks,
  listActivity,
} from "#/lib/workflow";
import { uniqueIdPrefix } from "#/lib/ids";

const resolveCurrentWorkspace = vi.fn<() => Promise<{ db: Database; ws: unknown }>>();

vi.mock("#/cli/context", () => ({
  resolveCurrentWorkspace,
}));

type RunnableSubCommand = {
  run: (ctx: { args: Record<string, string | undefined> }) => Promise<void> | void;
};

async function getSubCommand(command: { subCommands?: unknown }, name: string) {
  const subCommands = await command.subCommands;
  if (!subCommands || typeof subCommands !== "object" || !(name in subCommands)) {
    throw new Error(`Subcommand not found: ${name}`);
  }
  return (subCommands as Record<string, RunnableSubCommand>)[name]!;
}

describe("CLI commands", () => {
  let db: Database;
  let projectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
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

  it("task add resolves short PRD IDs and short dependency IDs", async () => {
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
        prd: prd.id.slice(0, 8),
        title: "Dependent task",
        desc: "desc",
        criteria: "done",
        effort: "m",
        depends: dependency.id.slice(0, 8),
      },
    });

    const tasks = await (await import("#/lib/workflow")).listTasks(db, prd.id);
    const created = tasks.find((task) => task.title === "Dependent task");

    expect(created).toBeTruthy();
    expect(JSON.parse(created!.dependsOn)).toEqual([dependency.id]);

    stdout.mockRestore();
  });

  it("task list resolves short PRD IDs", async () => {
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
        prdId: prd.id.slice(0, 8),
      },
    });

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Listed task"));

    stdout.mockRestore();
  });

  it("task list prints unique task prefixes when 8 chars collide", async () => {
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
        prdId: prd.id.slice(0, 8),
      },
    });

    const tasks = await listTasks(db, prd.id);
    const expectedPrefixes = tasks.map((task) => uniqueIdPrefix(task.id, tasks.map((t) => t.id)));
    const lines = stdout.mock.calls.map((call) => String(call[0]));
    for (const prefix of expectedPrefixes) {
      expect(lines.some((line) => line.startsWith(prefix))).toBe(true);
    }

    stdout.mockRestore();
  });

  it("log add resolves short PRD and task IDs", async () => {
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
        prd: prd.id.slice(0, 8),
        task: task.id.slice(0, 8),
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
});
