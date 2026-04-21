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
        desc: "desc",
        criteria: "done",
        effort: "m",
        depends: dependency.id,
      },
    });

    const tasks = await (await import("#/lib/workflow")).listTasks(db, prd.id);
    const created = tasks.find((task) => task.title === "Dependent task");

    expect(created).toBeTruthy();
    expect(JSON.parse(created!.dependsOn)).toEqual([dependency.id]);

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
      },
      cmd: contextCommand,
    });

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(String(stdout.mock.calls[0]?.[0])).toContain("=== DEPOT CONTEXT — PRD ===");
    expect(String(stdout.mock.calls[0]?.[0])).not.toContain("=== DEPOT CONTEXT — CONTEXT ===");

    stdout.mockRestore();
  });
});
