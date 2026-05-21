import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import fs from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { prdRevisions } from "#/db/schema";
import { Db } from "#/services/database";
import { formatStructuredTaskDescription } from "#/modules/tasks/spec";
import {
  addWorkspace,
  activatePrd,
  createPrd,
  createProject,
  createTask,
  startTask,
  listTasks,
  listActivity,
  getProject,
  getWorkspace,
} from "#/lib/workflow";
import { setJsonMode } from "#/shared/logger";

const resolveCurrentWorkspace = vi.fn<() => Promise<{ db: Database; ws: unknown }>>();
const getDb = vi.fn<() => Promise<Database>>();

// Holds the current test database; updated in beforeEach so each test gets a fresh db.
let currentTestDb: Database;

vi.mock("#/cli/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/cli/runtime")>();
  return {
    ...actual,
    resolveCurrentWorkspace,
    getDb,
    runEffect: <A, E>(effect: Effect.Effect<A, E, Db>) =>
      Effect.runPromise(Effect.provideService(effect, Db, currentTestDb)),
  };
});

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

async function captureConsoleError(fn: () => Promise<void>): Promise<string> {
  const messages: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((message) => {
    messages.push(String(message));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return messages.join("\n");
}

describe("CLI commands", () => {
  let db: Database;
  let projectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;

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
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    setJsonMode(false);
  });

  it("task add requires full PRD IDs and full dependency IDs", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "CLI PRD",
    });

    const dependency = await createTask(db, {
      prdRevisionId: prd.id,
      title: "Dependency",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await addCommand.run({
      args: {
        prdId: prd.id,
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

  it("task add stores structured task descriptions explicitly", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "CLI PRD",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await addCommand.run({
      args: {
        prdId: prd.id,
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

  it.each([
    ["--phase space", ["--phase", "1"]],
    ["--phase equals", ["--phase=1"]],
    ["-p space", ["-p", "1"]],
    ["-p equals", ["-p=1"]],
  ])("task add accepts numeric phase syntax from citty: %s", async (_label, phaseArgs) => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "Phased PRD",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(addCommand as any, {
      rawArgs: [
        "--prd-id",
        prd.id,
        "--title",
        `Phase task ${phaseArgs.join(" ")}`,
        "--desc",
        formatStructuredTaskDescription({
          intent: "Create a phased task.",
          scope: "Exercise CLI parsing.",
          nonGoals: "Do not touch the real depot database.",
        }),
        "--criteria",
        "phase is persisted",
        "--effort",
        "s",
        ...phaseArgs,
      ],
    });

    const tasks = await listTasks(db, prd.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.phaseNumber).toBe(1);

    stdout.mockRestore();
  });

  it("task update accepts numeric phase syntax from citty", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const updateCommand = await getSubCommand(taskCommand, "update");

    const prd = await createPrd(db, {
      projectId,
      title: "Phased PRD",
    });
    const task = await createTask(db, {
      prdRevisionId: prd.id,
      title: "Existing task",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
      phaseNumber: 1,
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(updateCommand as any, {
      rawArgs: [task.id, "--phase", "2"],
    });

    const tasks = await listTasks(db, prd.id);
    expect(tasks[0]!.phaseNumber).toBe(2);

    stdout.mockRestore();
  });

  it("task add accepts markdown-like long text without treating bullets as flags", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "Long text PRD",
    });
    const desc = formatStructuredTaskDescription({
      intent: "Keep long CLI text intact.",
      scope: ["pages_billing", "Preserve markdown-like bullets"],
      nonGoals: "Do not parse bullets as flags.",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(addCommand as any, {
      rawArgs: [
        "--prd-id",
        prd.id,
        "--title",
        "Long text task",
        "--desc",
        desc,
        "--criteria",
        "stored exactly",
        "--effort",
        "m",
      ],
    });

    const tasks = await listTasks(db, prd.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toContain("- pages_billing");

    stdout.mockRestore();
  });

  it("task add reads parser-sensitive criteria from a file in text mode", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "File input PRD",
    });
    const criteriaFile = join(tmpdir(), `depot-criteria-${Date.now()}.txt`);
    await fs.writeFile(criteriaFile, "Done when stored\n- pages_billing stays criteria text\n");

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runCommand(addCommand as any, {
        rawArgs: [
          "--prd-id",
          prd.id,
          "--title",
          "File criteria task",
          "--desc",
          "Read criteria from a file.",
          "--criteria-file",
          criteriaFile,
          "--effort",
          "s",
        ],
      });

      const tasks = await listTasks(db, prd.id);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.doneCriteria).toContain("- pages_billing stays criteria text");
    } finally {
      stdout.mockRestore();
      await fs.unlink(criteriaFile);
    }
  });

  it("task add reads description and criteria files in JSON mode", async () => {
    setJsonMode(true);
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "JSON file input PRD",
    });
    const descFile = join(tmpdir(), `depot-desc-${Date.now()}.txt`);
    const criteriaFile = join(tmpdir(), `depot-criteria-${Date.now()}-json.txt`);
    await fs.writeFile(
      descFile,
      formatStructuredTaskDescription({
        intent: "Read the description from disk.",
        scope: "- pages_billing must stay plain text.",
        nonGoals: "Do not change storage.",
      }),
    );
    await fs.writeFile(criteriaFile, "JSON envelope includes the created task");

    try {
      const output = await captureStdout(async () => {
        await runCommand(addCommand as any, {
          rawArgs: [
            "--prd-id",
            prd.id,
            "--title",
            "JSON file task",
            "--desc-file",
            descFile,
            "--criteria-file",
            criteriaFile,
            "--effort",
            "m",
          ],
        });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(parsed.payload.item.title).toBe("JSON file task");
      expect(parsed.payload.item.description).toContain("- pages_billing");
      expect(parsed.payload.item.doneCriteria).toBe("JSON envelope includes the created task");
    } finally {
      await fs.unlink(descFile);
      await fs.unlink(criteriaFile);
    }
  });

  it("task add reports empty description files as concise text", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "Empty file validation PRD",
    });
    const descFile = join(tmpdir(), `depot-desc-empty-${Date.now()}.txt`);
    await fs.writeFile(descFile, "");
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    try {
      const output = await captureConsoleError(async () => {
        await expect(
          runCommand(addCommand as any, {
            rawArgs: [
              "--prd-id",
              prd.id,
              "--title",
              "Empty desc file",
              "--desc-file",
              descFile,
              "--criteria",
              "done",
              "--effort",
              "s",
            ],
          }),
        ).rejects.toThrow("process.exit:1");
      });

      expect(output).toContain("--desc-file");
      expect(output).toContain("non-empty text");
      expect(output).not.toContain("minLength");
    } finally {
      exit.mockRestore();
      await fs.unlink(descFile);
    }
  });

  it("task add reports whitespace criteria files as JSON validation envelopes", async () => {
    setJsonMode(true);
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "JSON empty file validation PRD",
    });
    const criteriaFile = join(tmpdir(), `depot-criteria-empty-${Date.now()}.txt`);
    await fs.writeFile(criteriaFile, " \n\t ");
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    try {
      const output = await captureStdout(async () => {
        await expect(
          runCommand(addCommand as any, {
            rawArgs: [
              "--prd-id",
              prd.id,
              "--title",
              "Whitespace criteria file",
              "--desc",
              "desc",
              "--criteria-file",
              criteriaFile,
              "--effort",
              "s",
            ],
          }),
        ).rejects.toThrow("process.exit:1");
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("error");
      expect(parsed.error.code).toBe("validation_error");
      expect(parsed.error.message).toContain("--criteria-file");
      expect(parsed.error.message).toContain("non-empty text");
      expect(parsed.error.message).not.toContain("minLength");
    } finally {
      exit.mockRestore();
      await fs.unlink(criteriaFile);
    }
  });

  it("task add rejects conflicting inline and file criteria as JSON", async () => {
    setJsonMode(true);
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "Conflict PRD",
    });
    const criteriaFile = join(tmpdir(), `depot-criteria-conflict-${Date.now()}.txt`);
    await fs.writeFile(criteriaFile, "from file");
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    try {
      const output = await captureStdout(async () => {
        await expect(
          runCommand(addCommand as any, {
            rawArgs: [
              "--prd-id",
              prd.id,
              "--title",
              "Conflict task",
              "--desc",
              "desc",
              "--criteria",
              "inline",
              "--criteria-file",
              criteriaFile,
              "--effort",
              "s",
            ],
          }),
        ).rejects.toThrow("process.exit:1");
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("error");
      expect(parsed.error.code).toBe("conflicting_input");
      expect(parsed.error.message).toContain("--criteria-file");
    } finally {
      exit.mockRestore();
      await fs.unlink(criteriaFile);
    }
  });

  it("prd create reads context and scope from files", async () => {
    const { prdCommand } = await import("#/cli/commands/prds");
    const createCommand = await getSubCommand(prdCommand, "create");

    const contextFile = join(tmpdir(), `depot-context-${Date.now()}.txt`);
    const scopeFile = join(tmpdir(), `depot-scope-${Date.now()}.txt`);
    await fs.writeFile(contextFile, "Context:\n- pages_billing stays in context");
    await fs.writeFile(scopeFile, "Scope:\n- Include parser-safe file inputs");
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runCommand(createCommand as any, {
        rawArgs: ["--title", "File PRD", "--context-file", contextFile, "--scope-file", scopeFile],
      });

      const { listPrds } = await import("#/lib/workflow");
      const prds = await listPrds(db, { projectId });
      const created = prds.find((prd) => prd.title === "File PRD");
      expect(created?.context).toContain("- pages_billing stays in context");
      expect(created?.scope).toContain("- Include parser-safe file inputs");
    } finally {
      stdout.mockRestore();
      await fs.unlink(contextFile);
      await fs.unlink(scopeFile);
    }
  });

  it("task add reports parser validation errors as JSON envelopes", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "JSON validation PRD",
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    setJsonMode(true);

    const output = await captureStdout(async () => {
      await expect(
        runCommand(addCommand as any, {
          rawArgs: [
            "--prd-id",
            prd.id,
            "--title",
            "Bad phase",
            "--desc",
            "desc",
            "--criteria",
            "done",
            "--effort",
            "s",
            "--phase",
            "abc",
          ],
        }),
      ).rejects.toThrow("process.exit:1");
    });

    const parsed = JSON.parse(output.trim());
    expect(parsed.kind).toBe("error");
    expect(parsed.error.code).toBe("validation_error");
    expect(parsed.error.message).toContain("--phase");
    expect(parsed.error.message).not.toContain("Transformation process failure");

    exit.mockRestore();
  });

  it.each([
    ["0", '"0"'],
    ["-1", '"-1"'],
    ["abc", '"abc"'],
  ])("task add reports invalid phase %s as concise text", async (phase, received) => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "Text validation PRD",
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    const output = await captureConsoleError(async () => {
      await expect(
        runCommand(addCommand as any, {
          rawArgs: [
            "--prd-id",
            prd.id,
            "--title",
            "Bad phase",
            "--desc",
            "desc",
            "--criteria",
            "done",
            "--effort",
            "s",
            `--phase=${phase}`,
          ],
        }),
      ).rejects.toThrow("process.exit:1");
    });

    expect(output).toContain("--phase");
    expect(output).toContain(received);
    expect(output).not.toContain("Transformation process failure");

    exit.mockRestore();
  });

  it("task add reports invalid effort as concise text", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "Effort validation PRD",
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    const output = await captureConsoleError(async () => {
      await expect(
        runCommand(addCommand as any, {
          rawArgs: [
            "--prd-id",
            prd.id,
            "--title",
            "Bad effort",
            "--desc",
            "desc",
            "--criteria",
            "done",
            "--effort",
            "huge",
          ],
        }),
      ).rejects.toThrow("process.exit:1");
    });

    expect(output).toContain("--effort");
    expect(output).toContain("one of xs, s, m, l, xl");
    expect(output).not.toContain('Expected "xs"');

    exit.mockRestore();
  });

  it("task add reports empty descriptions as concise text", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const addCommand = await getSubCommand(taskCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "Description validation PRD",
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    const output = await captureConsoleError(async () => {
      await expect(
        runCommand(addCommand as any, {
          rawArgs: [
            "--prd-id",
            prd.id,
            "--title",
            "Empty desc",
            "--desc",
            "",
            "--criteria",
            "done",
            "--effort",
            "s",
          ],
        }),
      ).rejects.toThrow("process.exit:1");
    });

    expect(output).toContain("--desc");
    expect(output).toContain("non-empty text");
    expect(output).not.toContain("minLength");

    exit.mockRestore();
  });

  it("review start reports invalid type as a concise JSON validation error", async () => {
    const { reviewCommand } = await import("#/cli/commands/reviews");
    const startCommand = await getSubCommand(reviewCommand, "start");

    const prd = await createPrd(db, {
      projectId,
      title: "Review validation PRD",
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    setJsonMode(true);

    const output = await captureStdout(async () => {
      await expect(
        runCommand(startCommand as any, {
          rawArgs: [prd.id, "--type", "robot"],
        }),
      ).rejects.toThrow("process.exit:1");
    });

    const parsed = JSON.parse(output.trim());
    expect(parsed.kind).toBe("error");
    expect(parsed.error.code).toBe("validation_error");
    expect(parsed.error.message).toContain("--type");
    expect(parsed.error.message).toContain("one of human or agent");
    expect(parsed.error.message).not.toContain('Expected "human"');

    exit.mockRestore();
  });

  it("task list requires full PRD IDs", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const listCommand = await getSubCommand(taskCommand, "list");

    const prd = await createPrd(db, {
      projectId,
      title: "CLI PRD",
    });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
    await createTask(db, {
      prdRevisionId: prd.id,
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
    const { taskCommand } = await import("#/cli/commands/tasks");
    const listCommand = await getSubCommand(taskCommand, "list");

    const prd = await createPrd(db, {
      projectId,
      title: "CLI PRD",
    });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));

    await createTask(db, {
      prdRevisionId: prd.id,
      title: "Task A",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });
    await createTask(db, {
      prdRevisionId: prd.id,
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
    const { logCommand } = await import("#/cli/commands/activity");
    const addCommand = await getSubCommand(logCommand, "add");

    const prd = await createPrd(db, {
      projectId,
      title: "CLI PRD",
    });
    const task = await createTask(db, {
      prdRevisionId: prd.id,
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
    expect(entries[0]!.prdRevisionId).toBe(prd.id);
    expect(entries[0]!.taskId).toBe(task.id);

    stdout.mockRestore();
  });

  it("log add accepts PowerShell-mangled payload objects", async () => {
    const { logCommand } = await import("#/cli/commands/activity");
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
    const { taskCommand } = await import("#/cli/commands/tasks");
    const showCommand = await getSubCommand(taskCommand, "show");

    const prd = await createPrd(db, {
      projectId,
      title: "CLI PRD",
    });

    const task = await createTask(db, {
      prdRevisionId: prd.id,
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

  it.each([
    ["asterisk", "* First criterion\n* Second criterion"],
    ["dash", "- First criterion\n- Second criterion"],
  ])("task show normalizes %s criteria bullets", async (_label, doneCriteria) => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const showCommand = await getSubCommand(taskCommand, "show");

    const prd = await createPrd(db, {
      projectId,
      title: "CLI PRD",
    });

    const task = await createTask(db, {
      prdRevisionId: prd.id,
      title: "Bulleted criteria task",
      description: formatStructuredTaskDescription({
        intent: "Keep the output readable.",
        scope: ["Normalize bullet markers", "Preserve structured headings"],
        nonGoals: ["Do not add markdown rendering"],
      }),
      doneCriteria,
      effort: "s",
    });

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await showCommand.run({
      args: {
        taskId: task.id,
      },
    });

    const lines = stdout.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain("Intent      : Keep the output readable.");
    expect(lines).toContain("Scope       : - Normalize bullet markers");
    expect(lines).toContain("Non-goals   : - Do not add markdown rendering");
    expect(lines).toContain("Criteria    : - First criterion");
    expect(lines.some((line) => line.trim() === "- Second criterion")).toBe(true);
    expect(lines.some((line) => line.includes("- * First criterion"))).toBe(false);
    expect(lines.some((line) => line.includes("- - First criterion"))).toBe(false);

    stdout.mockRestore();
  });

  it("task skip renders long reasons without ANSI control codes", async () => {
    const { taskCommand } = await import("#/cli/commands/tasks");
    const skipCommand = await getSubCommand(taskCommand, "skip");

    const prd = await createPrd(db, {
      projectId,
      title: "Skip output PRD",
    });
    const task = await createTask(db, {
      prdRevisionId: prd.id,
      title: "Skipped task",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });
    const longReason =
      "This reason is intentionally long enough to be rendered across a compact block because it includes implementation detail that would be hard to scan inline.";
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await skipCommand.run({
      args: {
        taskId: task.id,
        reason: longReason,
      },
    });

    const text = stdout.mock.calls.map((call) => String(call[0])).join("\n");
    expect(text).toContain(`Skipped task 'Skipped task' (${task.id})`);
    expect(text).toContain("Reason:\n  This reason is intentionally long");
    expect(text).not.toContain(String.fromCharCode(27));

    stdout.mockRestore();
  });

  it("context mode renders only the requested mode", async () => {
    const { contextCommand } = await import("#/cli/commands/context");
    const prd = await createPrd(db, {
      projectId,
      title: "CLI PRD",
    });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await contextCommand.run?.({
      rawArgs: [],
      // citty's raw arg values don't include undefined; cast is required here
      args: { mode: "prd", prdTarget: undefined } as any,
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
      const { prdCommand } = await import("#/cli/commands/prds");
      const listCommand = await getSubCommand(prdCommand, "list");

      await createPrd(db, { projectId, title: "PRD Alpha" });
      await createPrd(db, { projectId, title: "PRD Beta" });

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
      const { prdCommand } = await import("#/cli/commands/prds");
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
      const { prdCommand } = await import("#/cli/commands/prds");
      const showCommand = await getSubCommand(prdCommand, "show");

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      const output = await captureStdout(async () => {
        await expect(showCommand.run({ args: { prdId: "NONEXISTENT" } })).rejects.toThrow(
          "process.exit:1",
        );
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("error");
      expect(parsed.error.code).toBe("not_found");

      exit.mockRestore();
    });

    it("task list emits success envelope with items and parsed dependsOn arrays", async () => {
      const { taskCommand } = await import("#/cli/commands/tasks");
      const listCmd = await getSubCommand(taskCommand, "list");

      const prd = await createPrd(db, { projectId, title: "JSON PRD" });
      await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));

      const dep = await createTask(db, {
        prdRevisionId: prd.id,
        title: "Dep task",
        description: "d",
        doneCriteria: "c",
        effort: "s",
      });
      await createTask(db, {
        prdRevisionId: prd.id,
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
      const { taskCommand } = await import("#/cli/commands/tasks");
      const addCmd = await getSubCommand(taskCommand, "add");

      const prd = await createPrd(db, { projectId, title: "JSON PRD" });

      const output = await captureStdout(async () => {
        await addCmd.run({
          args: {
            prdId: prd.id,
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

    it("task done emits success envelope with item", async () => {
      const { taskCommand } = await import("#/cli/commands/tasks");
      const doneCmd = await getSubCommand(taskCommand, "done");

      const prd = await createPrd(db, { projectId, title: "JSON Task Done PRD" });
      const task = await createTask(db, {
        prdRevisionId: prd.id,
        title: "Done task",
        description: "d",
        doneCriteria: "c",
        effort: "s",
      });
      await startTask(db, task.id);

      const output = await captureStdout(async () => {
        await doneCmd.run({ args: { taskId: task.id } });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(parsed.payload.item.id).toBe(task.id);
      expect(parsed.payload.item.status).toBe("done");
    });

    it("task skip emits success envelope with item", async () => {
      const { taskCommand } = await import("#/cli/commands/tasks");
      const skipCmd = await getSubCommand(taskCommand, "skip");

      const prd = await createPrd(db, { projectId, title: "JSON Task Skip PRD" });
      const task = await createTask(db, {
        prdRevisionId: prd.id,
        title: "Skipped task",
        description: "d",
        doneCriteria: "c",
        effort: "s",
      });

      const output = await captureStdout(async () => {
        await skipCmd.run({ args: { taskId: task.id, reason: "not needed" } });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(parsed.payload.item.id).toBe(task.id);
      expect(parsed.payload.item.status).toBe("skipped");
      expect(parsed.payload.item.skipReason).toBe("not needed");
    });

    it("review task add and review list emit standard JSON envelopes", async () => {
      const { reviewCommand } = await import("#/cli/commands/reviews");
      const reviewTaskCommand = await getSubCommand(reviewCommand, "task");
      const taskAddCommand = await getSubCommand(reviewTaskCommand as any, "add");
      const reviewListCommand = await getSubCommand(reviewCommand, "list");
      const { createReview } = await import("#/lib/workflow");

      const prd = await createPrd(db, { projectId, title: "Review JSON PRD" });
      const review = await createReview(db, { prdRevisionId: prd.id, type: "human" });

      const addOutput = await captureStdout(async () => {
        await taskAddCommand.run({
          args: {
            reviewId: review.id,
            title: "Finding",
            description: "Explain the issue",
            doneCriteria: "Issue is fixed",
            severity: "major",
          },
        });
      });

      const addParsed = JSON.parse(addOutput.trim());
      expect(addParsed.kind).toBe("success");
      expect(addParsed.payload.item.title).toBe("Finding");
      expect(addParsed.payload.item.reviewId).toBe(review.id);

      const listOutput = await captureStdout(async () => {
        await reviewListCommand.run({ args: { prdId: prd.id } });
      });

      const listParsed = JSON.parse(listOutput.trim());
      expect(listParsed.kind).toBe("success");
      expect(Array.isArray(listParsed.payload.items)).toBe(true);
      expect(listParsed.payload.items[0].id).toBe(review.id);
    });

    it("log list emits success envelope with parsed payload objects", async () => {
      const { logCommand } = await import("#/cli/commands/activity");
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
      const { prdCommand } = await import("#/cli/commands/prds");
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

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      const output = await captureStdout(async () => {
        await expect(
          contextCommand.run?.({
            rawArgs: [],
            args: { mode: undefined, prdTarget: undefined } as any,
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

  describe("project commands", () => {
    it("project show displays project details", async () => {
      const { projectCommand } = await import("#/cli/commands/projects");
      const showCommand = await getSubCommand(projectCommand, "show");

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await showCommand.run({ args: { projectId } });
      output.mockRestore();

      const project = await getProject(db, projectId);
      expect(project).not.toBeNull();
      expect(project!.id).toBe(projectId);
    });

    it("project show errors on unknown id", async () => {
      const { projectCommand } = await import("#/cli/commands/projects");
      const showCommand = await getSubCommand(projectCommand, "show");

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      await expect(showCommand.run({ args: { projectId: "nonexistent" } })).rejects.toThrow(
        "process.exit:1",
      );

      exit.mockRestore();
    });

    it("project update changes the project name", async () => {
      const { projectCommand } = await import("#/cli/commands/projects");
      const updateCommand = await getSubCommand(projectCommand, "update");

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await updateCommand.run({ args: { projectId, name: "renamed-project" } });
      output.mockRestore();

      const project = await getProject(db, projectId);
      expect(project!.name).toBe("renamed-project");
    });

    it("project update errors when no changes provided", async () => {
      const { projectCommand } = await import("#/cli/commands/projects");
      const updateCommand = await getSubCommand(projectCommand, "update");

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      await expect(updateCommand.run({ args: { projectId } })).rejects.toThrow("process.exit:1");

      exit.mockRestore();
    });

    it("project archive sets status to done", async () => {
      const { projectCommand } = await import("#/cli/commands/projects");
      const archiveCommand = await getSubCommand(projectCommand, "archive");

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await archiveCommand.run({ args: { projectId } });
      output.mockRestore();

      const project = await getProject(db, projectId);
      expect(project!.status).toBe("done");
    });

    it("project archive errors if already done", async () => {
      const { projectCommand } = await import("#/cli/commands/projects");
      const archiveCommand = await getSubCommand(projectCommand, "archive");

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await archiveCommand.run({ args: { projectId } });
      output.mockRestore();

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      await expect(archiveCommand.run({ args: { projectId } })).rejects.toThrow("process.exit:1");

      exit.mockRestore();
    });
  });

  describe("workspace commands", () => {
    it("workspace list shows all workspaces", async () => {
      const { workspaceCommand } = await import("#/cli/commands/workspaces");
      const listCommand = await getSubCommand(workspaceCommand, "list");

      const lines: string[] = [];
      const output = vi.spyOn(console, "log").mockImplementation((msg) => lines.push(msg));
      await listCommand.run({ args: {} });
      output.mockRestore();

      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toContain(workspaceId);
    });

    it("workspace show displays workspace details", async () => {
      const { workspaceCommand } = await import("#/cli/commands/workspaces");
      const showCommand = await getSubCommand(workspaceCommand, "show");

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await showCommand.run({ args: { workspaceId } });
      output.mockRestore();

      const ws = await getWorkspace(db, workspaceId);
      expect(ws).not.toBeNull();
    });

    it("workspace show errors on unknown id", async () => {
      const { workspaceCommand } = await import("#/cli/commands/workspaces");
      const showCommand = await getSubCommand(workspaceCommand, "show");

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      await expect(showCommand.run({ args: { workspaceId: "nonexistent" } })).rejects.toThrow(
        "process.exit:1",
      );

      exit.mockRestore();
    });

    it("workspace rename updates the label", async () => {
      const { workspaceCommand } = await import("#/cli/commands/workspaces");
      const renameCommand = await getSubCommand(workspaceCommand, "rename");

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await renameCommand.run({ args: { workspaceId, label: "my-label" } });
      output.mockRestore();

      const ws = await getWorkspace(db, workspaceId);
      expect(ws!.label).toBe("my-label");
    });

    it("workspace remove fails when PRDs are linked", async () => {
      const { workspaceCommand } = await import("#/cli/commands/workspaces");
      const removeCommand = await getSubCommand(workspaceCommand, "remove");

      const prd = await createPrd(db, { projectId, title: "linked PRD" });
      await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
      await activatePrd(db, prd.id, workspaceId);

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      await expect(removeCommand.run({ args: { workspaceId, force: false } })).rejects.toThrow(
        "process.exit:1",
      );

      exit.mockRestore();
    });

    it("workspace remove --force cascades linked data", async () => {
      const { workspaceCommand } = await import("#/cli/commands/workspaces");
      const removeCommand = await getSubCommand(workspaceCommand, "remove");

      const prd = await createPrd(db, { projectId, title: "linked PRD" });
      await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
      await activatePrd(db, prd.id, workspaceId);

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await removeCommand.run({ args: { workspaceId, force: true } });
      output.mockRestore();

      const ws = await getWorkspace(db, workspaceId);
      expect(ws).toBeNull();
    });
  });

  describe("prd lifecycle commands", () => {
    it("prd update updates a draft PRD", async () => {
      const { prdCommand } = await import("#/cli/commands/prds");
      const updateCommand = await getSubCommand(prdCommand, "update");

      const prd = await createPrd(db, { projectId, title: "Lifecycle PRD" });

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await updateCommand.run({ args: { prdId: prd.id, title: "Updated PRD", context: "new" } });
      output.mockRestore();

      const { getPrd } = await import("#/lib/workflow");
      const updated = await getPrd(db, prd.id);
      expect(updated!.title).toBe("Updated PRD");
      expect(updated!.context).toBe("new");
    });

    it("prd ready marks a draft PRD as ready", async () => {
      const { prdCommand } = await import("#/cli/commands/prds");
      const readyCommand = await getSubCommand(prdCommand, "ready");

      const prd = await createPrd(db, { projectId, title: "Lifecycle PRD" });

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await readyCommand.run({ args: { prdId: prd.id } });
      output.mockRestore();

      const { getPrd } = await import("#/lib/workflow");
      const updated = await getPrd(db, prd.id);
      expect(updated!.status).toBe("ready");
    });

    it("prd done marks a PRD as done from the review state", async () => {
      const { prdCommand } = await import("#/cli/commands/prds");
      const doneCommand = await getSubCommand(prdCommand, "done");

      const prd = await createPrd(db, { projectId, title: "Lifecycle PRD" });
      await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
      await activatePrd(db, prd.id, workspaceId);
      // PRDs must cross the human-review gate before closing.
      const { requestReviewPrd } = await import("#/lib/workflow");
      await requestReviewPrd(db, prd.id);

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await doneCommand.run({ args: { prdId: prd.id } });
      output.mockRestore();

      const { getPrd } = await import("#/lib/workflow");
      const updated = await getPrd(db, prd.id);
      expect(updated!.status).toBe("done");
    });

    it("prd cancel cancels a draft PRD", async () => {
      const { prdCommand } = await import("#/cli/commands/prds");
      const cancelCommand = await getSubCommand(prdCommand, "cancel");

      const prd = await createPrd(db, { projectId, title: "Lifecycle PRD" });

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await cancelCommand.run({ args: { prdId: prd.id } });
      output.mockRestore();

      const { getPrd } = await import("#/lib/workflow");
      const updated = await getPrd(db, prd.id);
      expect(updated!.status).toBe("canceled");
    });

    it("prd ready errors for unknown PRD", async () => {
      const { prdCommand } = await import("#/cli/commands/prds");
      const readyCommand = await getSubCommand(prdCommand, "ready");

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      await expect(readyCommand.run({ args: { prdId: "NONEXISTENT" } })).rejects.toThrow(
        "process.exit:1",
      );

      exit.mockRestore();
    });
  });

  // ── prd capture-merge ──────────────────────────────────────────────────────

  describe("prd capture-merge", () => {
    const captureMergeTempDirs: string[] = [];

    async function makeGitRepoForMerge(): Promise<{ root: string; sha: string }> {
      const { execFileSync } = await import("node:child_process");
      const root = join(tmpdir(), `depot-cm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await fs.mkdir(root, { recursive: true });
      const real = await fs.realpath(root);
      captureMergeTempDirs.push(real);
      execFileSync("git", ["init", "-q"], { cwd: real });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: real });
      execFileSync("git", ["config", "user.name", "t"], { cwd: real });
      await fs.writeFile(join(real, "f.txt"), "hello");
      execFileSync("git", ["add", "."], { cwd: real });
      execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: real });
      const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: real }).toString().trim();
      return { root: real, sha };
    }

    afterEach(async () => {
      for (const dir of captureMergeTempDirs.splice(0)) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("captures HEAD for a mono-repo project with no flags (zero config)", async () => {
      const { prdCommand } = await import("#/cli/commands/prds");
      const captureMerge = await getSubCommand(prdCommand, "capture-merge");
      const { listMerges } = await import("#/modules/prds/domain");

      const repo = await makeGitRepoForMerge();
      const ws = await addWorkspace(db, { projectId, path: repo.root });
      resolveCurrentWorkspace.mockResolvedValue({ db, ws });

      const prd = await createPrd(db, { projectId, title: "Mono merge PRD" });

      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      await captureMerge.run({ args: { prdId: prd.id } });
      stdout.mockRestore();

      const merges = await Effect.runPromise(Effect.provideService(listMerges(prd.id), Db, db));
      expect(merges).toHaveLength(1);
      expect(merges[0]?.repoName).toBe("(default)");
      expect(merges[0]?.mergeSha).toBe(repo.sha);
      expect(merges[0]?.repoId).toBeNull();
    });

    it("anchors multiple repos in one call with --repo name=sha", async () => {
      const { prdCommand } = await import("#/cli/commands/prds");
      const captureMerge = await getSubCommand(prdCommand, "capture-merge");
      const { addRepo } = await import("#/modules/projects/repos");
      const { listMerges } = await import("#/modules/prds/domain");

      const front = await makeGitRepoForMerge();
      const api = await makeGitRepoForMerge();
      await Effect.runPromise(
        Effect.provideService(addRepo({ projectId, name: "front", path: front.root }), Db, db),
      );
      await Effect.runPromise(
        Effect.provideService(addRepo({ projectId, name: "api", path: api.root }), Db, db),
      );

      const prd = await createPrd(db, { projectId, title: "Multi merge PRD" });

      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      await captureMerge.run({
        args: { prdId: prd.id, repo: [`front=${front.sha}`, `api=${api.sha}`] },
      });
      stdout.mockRestore();

      const merges = await Effect.runPromise(Effect.provideService(listMerges(prd.id), Db, db));
      expect(merges.map((m) => m.repoName).sort()).toEqual(["api", "front"]);
    });

    it("refuses an unregistered repo name in a multi-repo project", async () => {
      const { prdCommand } = await import("#/cli/commands/prds");
      const captureMerge = await getSubCommand(prdCommand, "capture-merge");
      const { addRepo } = await import("#/modules/projects/repos");

      const front = await makeGitRepoForMerge();
      await Effect.runPromise(
        Effect.provideService(addRepo({ projectId, name: "front", path: front.root }), Db, db),
      );
      const prd = await createPrd(db, { projectId, title: "Refuse repo PRD" });

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        captureMerge.run({ args: { prdId: prd.id, repo: [`unknown=${front.sha}`] } }),
      ).rejects.toThrow("process.exit:1");

      stderr.mockRestore();
      exit.mockRestore();
    });

    it("refuses a SHA that does not exist in the repo", async () => {
      const { prdCommand } = await import("#/cli/commands/prds");
      const captureMerge = await getSubCommand(prdCommand, "capture-merge");
      const { addRepo } = await import("#/modules/projects/repos");

      const front = await makeGitRepoForMerge();
      await Effect.runPromise(
        Effect.provideService(addRepo({ projectId, name: "front", path: front.root }), Db, db),
      );
      const prd = await createPrd(db, { projectId, title: "Refuse SHA PRD" });

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        captureMerge.run({
          args: {
            prdId: prd.id,
            repo: ["front=0000000000000000000000000000000000000000"],
          },
        }),
      ).rejects.toThrow("process.exit:1");

      stderr.mockRestore();
      exit.mockRestore();
    });
  });

  // ── context ship per-repo state ───────────────────────────────────────────

  describe("context ship", () => {
    const shipTempDirs: string[] = [];

    async function makeShipRepo(): Promise<string> {
      const { execFileSync } = await import("node:child_process");
      const root = join(tmpdir(), `depot-cs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await fs.mkdir(root, { recursive: true });
      const real = await fs.realpath(root);
      shipTempDirs.push(real);
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: real });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: real });
      execFileSync("git", ["config", "user.name", "t"], { cwd: real });
      await fs.writeFile(join(real, "f.txt"), "hello");
      execFileSync("git", ["add", "."], { cwd: real });
      execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: real });
      return real;
    }

    afterEach(async () => {
      for (const dir of shipTempDirs.splice(0)) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("injects single implicit repo state for a mono-repo PRD", async () => {
      const { contextCommand } = await import("#/cli/commands/context");
      const repo = await makeShipRepo();
      const ws = await addWorkspace(db, { projectId, path: repo });
      resolveCurrentWorkspace.mockResolvedValue({ db, ws });

      const prd = await createPrd(db, { projectId, title: "Ship mono PRD" });

      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      await contextCommand.run?.({
        rawArgs: [],
        args: { mode: "ship", prdTarget: prd.id } as any,
        cmd: contextCommand,
      });
      const out = String(stdout.mock.calls[0]?.[0]);
      stdout.mockRestore();

      expect(out).toContain("=== DEPOT CONTEXT — SHIP ===");
      expect(out).toContain(`Shipping: Ship mono PRD (${prd.id}) [draft]`);
      expect(out).toContain("Doc sync: not yet run for this PRD");
      expect(out).toContain("Repos   : single implicit repo");
      expect(out).toContain("(default)");
      expect(out).toContain("base branch : main");
      expect(out).toContain("status      : clean");
    });

    it("reports when the doc sync already ran for the shipped PRD", async () => {
      const { contextCommand } = await import("#/cli/commands/context");
      const { createProfile, recordSyncRun } = await import("#/modules/docs/sync");
      const repo = await makeShipRepo();
      const ws = await addWorkspace(db, { projectId, path: repo });
      resolveCurrentWorkspace.mockResolvedValue({ db, ws });

      const prd = await createPrd(db, { projectId, title: "Doc-synced ship PRD" });
      const provide = <A, E>(effect: Effect.Effect<A, E, Db>): Promise<A> =>
        Effect.runPromise(Effect.provideService(effect, Db, db));
      const profile = await provide(
        createProfile({ projectId, name: "ship-doc", targetRoot: "docs" }),
      );
      await provide(recordSyncRun({ profileId: profile.id, triggeredByPrdId: prd.id }));

      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      await contextCommand.run?.({
        rawArgs: [],
        args: { mode: "ship", prdTarget: prd.id } as any,
        cmd: contextCommand,
      });
      const out = String(stdout.mock.calls[0]?.[0]);
      stdout.mockRestore();

      expect(out).toContain("Doc sync: already ran for this PRD");
    });

    it("injects per-repo state for a multi-repo PRD", async () => {
      const { contextCommand } = await import("#/cli/commands/context");
      const { addRepo } = await import("#/modules/projects/repos");
      const front = await makeShipRepo();
      const api = await makeShipRepo();
      const ws = await addWorkspace(db, { projectId, path: front });
      resolveCurrentWorkspace.mockResolvedValue({ db, ws });
      await Effect.runPromise(
        Effect.provideService(addRepo({ projectId, name: "front", path: front }), Db, db),
      );
      await Effect.runPromise(
        Effect.provideService(
          addRepo({ projectId, name: "api", path: api, baseBranch: "develop" }),
          Db,
          db,
        ),
      );

      const prd = await createPrd(db, { projectId, title: "Ship multi PRD" });

      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      await contextCommand.run?.({
        rawArgs: [],
        args: { mode: "ship", prdTarget: prd.id } as any,
        cmd: contextCommand,
      });
      const out = String(stdout.mock.calls[0]?.[0]);
      stdout.mockRestore();

      expect(out).toContain("Repos   : multi-repo project");
      expect(out).toContain("- front");
      expect(out).toContain("- api");
      expect(out).toContain("base branch : develop");
    });

    it("degrades gracefully when the PRD is not found", async () => {
      const { contextCommand } = await import("#/cli/commands/context");
      const repo = await makeShipRepo();
      const ws = await addWorkspace(db, { projectId, path: repo });
      resolveCurrentWorkspace.mockResolvedValue({ db, ws });

      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      await contextCommand.run?.({
        rawArgs: [],
        args: { mode: "ship", prdTarget: "does-not-exist" } as any,
        cmd: contextCommand,
      });
      const out = String(stdout.mock.calls[0]?.[0]);
      stdout.mockRestore();

      expect(out).toContain("=== DEPOT CONTEXT — SHIP ===");
      expect(out).toContain("not found");
      expect(out).toContain("Ship Agent");
    });
  });

  // ── context doc precomputed state ─────────────────────────────────────────

  describe("context doc", () => {
    function provide<A, E>(effect: Effect.Effect<A, E, Db>): Promise<A> {
      return Effect.runPromise(Effect.provideService(effect, Db, db));
    }

    async function runContextDoc(): Promise<string> {
      const { contextCommand } = await import("#/cli/commands/context");
      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await contextCommand.run?.({
          rawArgs: [],
          args: { mode: "doc", prdTarget: "" } as any,
          cmd: contextCommand,
        });
        return String(stdout.mock.calls[0]?.[0]);
      } finally {
        stdout.mockRestore();
      }
    }

    it("reports when no doc profiles are configured", async () => {
      const out = await runContextDoc();
      expect(out).toContain("=== DEPOT CONTEXT — DOC ===");
      expect(out).toContain("no doc profiles configured");
    });

    it("injects active doc profiles and the last sync run", async () => {
      const { createProfile, recordSyncRun } = await import("#/modules/docs/sync");
      const profile = await provide(
        createProfile({
          projectId,
          name: "handbook",
          targetRoot: "docs/handbook",
          language: "fr",
          style: "narrative",
        }),
      );
      await provide(
        recordSyncRun({
          profileId: profile.id,
          summary: "synced handbook",
        }),
      );

      const out = await runContextDoc();
      expect(out).toContain("1 doc profile(s)");
      expect(out).toContain("- handbook");
      expect(out).toContain("target root : docs/handbook");
      expect(out).toContain("language    : fr");
      expect(out).toContain("last sync   :");
    });

    it("reports a profile that has never been synced", async () => {
      const { createProfile } = await import("#/modules/docs/sync");
      await provide(createProfile({ projectId, name: "reference", targetRoot: "docs/reference" }));
      const out = await runContextDoc();
      expect(out).toContain("- reference");
      expect(out).toContain("(never synced)");
    });
  });

  // ── prd validate (extended checks) ────────────────────────────────────────

  describe("prd validate", () => {
    async function runValidate(prdId: string): Promise<{
      checks: Array<{ level: string; message: string }>;
      summary: { errors: number; warnings: number; ready: boolean };
    }> {
      setJsonMode(true);
      const { prdCommand } = await import("#/cli/commands/prds");
      const validateCommand = await getSubCommand(prdCommand, "validate");
      const output = await captureStdout(async () => {
        await validateCommand.run({ args: { prdId } });
      });
      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      return parsed.payload;
    }

    function provide<A, E>(effect: Effect.Effect<A, E, Db>): Promise<A> {
      return Effect.runPromise(Effect.provideService(effect, Db, db));
    }

    it("reports errors when problem, solution, and user stories are missing", async () => {
      const prd = await createPrd(db, { projectId, title: "Bare PRD" });
      const payload = await runValidate(prd.id);
      const messages = payload.checks.map((c) => c.message);
      const errored = (m: string) =>
        payload.checks.find((c) => c.message === m && c.level === "error");

      expect(errored("problem statement missing")).toBeTruthy();
      expect(errored("solution missing")).toBeTruthy();
      expect(messages.some((m) => /user story\(ies\) defined/.test(m))).toBe(true);
      expect(
        payload.checks.find(
          (c) => /user story\(ies\) defined/.test(c.message) && c.level === "error",
        ),
      ).toBeTruthy();
      expect(payload.summary.errors).toBeGreaterThanOrEqual(3);
    });

    it("warns when implementation and testing decisions are not recorded", async () => {
      const prd = await createPrd(db, { projectId, title: "No-decisions PRD" });
      const payload = await runValidate(prd.id);
      const warned = (m: string) =>
        payload.checks.find((c) => c.message === m && c.level === "warn");
      expect(warned("implementation decisions not recorded")).toBeTruthy();
      expect(warned("testing decisions not recorded")).toBeTruthy();
    });

    it("clears section errors once problem, solution, and a story are set", async () => {
      const { updatePrdSections } = await import("#/modules/prds/domain");
      const { createUserStory } = await import("#/modules/prds/stories");
      const prd = await createPrd(db, { projectId, title: "Filled PRD" });
      await provide(
        updatePrdSections(prd.id, {
          problem: "Agents cannot tell which PRD a diff belongs to.",
          solution: "Anchor each merge with a prd_merge row.",
          implementationDecisions: "Use a join table.",
          testingDecisions: "Unit tests on the resolver.",
        }),
      );
      await provide(
        createUserStory({
          prdRevisionId: prd.id,
          asRole: "reviewer",
          want: "to see the right diff",
          so: "I can approve faster",
        }),
      );
      const payload = await runValidate(prd.id);
      const ok = (m: string) => payload.checks.find((c) => c.message === m && c.level === "ok");
      expect(ok("problem statement set")).toBeTruthy();
      expect(ok("solution set")).toBeTruthy();
      expect(ok("implementation decisions set")).toBeTruthy();
      expect(ok("testing decisions set")).toBeTruthy();
    });

    it("warns when a user story is not linked to any task", async () => {
      const { createUserStory, linkStoryToTask } = await import("#/modules/prds/stories");
      const prd = await createPrd(db, { projectId, title: "Story coverage PRD" });
      const linked = await provide(
        createUserStory({
          prdRevisionId: prd.id,
          asRole: "user",
          want: "covered story",
          so: "it ships",
        }),
      );
      await provide(
        createUserStory({
          prdRevisionId: prd.id,
          asRole: "user",
          want: "uncovered story",
          so: "it is flagged",
        }),
      );
      const task = await createTask(db, {
        prdRevisionId: prd.id,
        title: "Implement covered story",
        description: "desc",
        doneCriteria: "the covered story is implemented and tested thoroughly",
        effort: "s",
      });
      await provide(linkStoryToTask(linked.id, task.id));

      const payload = await runValidate(prd.id);
      const coverage = payload.checks.find((c) => /not linked to any task/.test(c.message));
      expect(coverage).toBeTruthy();
      expect(coverage!.level).toBe("warn");
    });

    it("passes story coverage when every story is linked to a task", async () => {
      const { createUserStory, linkStoryToTask } = await import("#/modules/prds/stories");
      const prd = await createPrd(db, { projectId, title: "Full coverage PRD" });
      const story = await provide(
        createUserStory({
          prdRevisionId: prd.id,
          asRole: "user",
          want: "a covered story",
          so: "it ships",
        }),
      );
      const task = await createTask(db, {
        prdRevisionId: prd.id,
        title: "Implement story",
        description: "desc",
        doneCriteria: "the story is implemented with full coverage of edge cases",
        effort: "s",
      });
      await provide(linkStoryToTask(story.id, task.id));

      const payload = await runValidate(prd.id);
      expect(
        payload.checks.find(
          (c) => c.message === "all user stories are linked to at least one task",
        ),
      ).toBeTruthy();
    });
  });

  // ── prd load ──────────────────────────────────────────────────────────────

  describe("prd load", () => {
    let tmpFile: string;

    beforeEach(() => {
      tmpFile = join(tmpdir(), `depot-test-${Date.now()}.json`);
    });

    afterEach(async () => {
      try {
        await fs.unlink(tmpFile);
      } catch {
        // ignore
      }
    });

    it("loads a PRD with tasks from a file (draft)", async () => {
      setJsonMode(true);
      const { prdCommand } = await import("#/cli/commands/prds");
      const loadCommand = await getSubCommand(prdCommand, "load");

      const payload = {
        title: "Loaded PRD",
        context: "For testing",
        ready: false,
        tasks: [
          {
            title: "Task A",
            description: "Desc A",
            doneCriteria: "Done A",
            effort: "s",
            dependsOn: [],
          },
          {
            title: "Task B",
            description: "Desc B",
            doneCriteria: "Done B",
            effort: "m",
            dependsOn: [0],
          },
        ],
      };
      await fs.writeFile(tmpFile, JSON.stringify(payload));

      const output = await captureStdout(async () => {
        await loadCommand.run({ args: { file: tmpFile } });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(parsed.payload.prd.title).toBe("Loaded PRD");
      expect(parsed.payload.prd.status).toBe("draft");
      expect(parsed.payload.tasks).toHaveLength(2);
      // Check dependency resolved
      const task1Deps: string[] = JSON.parse(parsed.payload.tasks[1].dependsOn);
      expect(task1Deps).toEqual([parsed.payload.tasks[0].id]);
    });

    it("loads a PRD and marks it ready when ready:true", async () => {
      setJsonMode(true);
      const { prdCommand } = await import("#/cli/commands/prds");
      const loadCommand = await getSubCommand(prdCommand, "load");

      const payload = {
        title: "Ready PRD",
        ready: true,
        tasks: [
          { title: "Task 1", description: "D", doneCriteria: "C", effort: "xs", dependsOn: [] },
        ],
      };
      await fs.writeFile(tmpFile, JSON.stringify(payload));

      const output = await captureStdout(async () => {
        await loadCommand.run({ args: { file: tmpFile } });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("success");
      expect(parsed.payload.prd.status).toBe("ready");
    });

    it("rejects invalid JSON", async () => {
      setJsonMode(true);
      const { prdCommand } = await import("#/cli/commands/prds");
      const loadCommand = await getSubCommand(prdCommand, "load");

      await fs.writeFile(tmpFile, "not json {{");

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      const output = await captureStdout(async () => {
        await expect(loadCommand.run({ args: { file: tmpFile } })).rejects.toThrow(
          "process.exit:1",
        );
      });

      exit.mockRestore();
      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("error");
      expect(parsed.error.code).toBe("invalid_json");
    });

    it("rejects out-of-bound dependsOn index", async () => {
      setJsonMode(true);
      const { prdCommand } = await import("#/cli/commands/prds");
      const loadCommand = await getSubCommand(prdCommand, "load");

      const payload = {
        title: "Bad Deps PRD",
        ready: false,
        tasks: [
          { title: "Task A", description: "D", doneCriteria: "C", effort: "s", dependsOn: [5] },
        ],
      };
      await fs.writeFile(tmpFile, JSON.stringify(payload));

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      const output = await captureStdout(async () => {
        await expect(loadCommand.run({ args: { file: tmpFile } })).rejects.toThrow(
          "process.exit:1",
        );
      });

      exit.mockRestore();
      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("error");
      expect(parsed.error.code).toBe("invalid_depends_on");
    });

    it("rejects forward reference in dependsOn", async () => {
      setJsonMode(true);
      const { prdCommand } = await import("#/cli/commands/prds");
      const loadCommand = await getSubCommand(prdCommand, "load");

      const payload = {
        title: "Forward Ref PRD",
        ready: false,
        tasks: [
          { title: "Task A", description: "D", doneCriteria: "C", effort: "s", dependsOn: [1] },
          { title: "Task B", description: "D", doneCriteria: "C", effort: "s", dependsOn: [] },
        ],
      };
      await fs.writeFile(tmpFile, JSON.stringify(payload));

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      const output = await captureStdout(async () => {
        await expect(loadCommand.run({ args: { file: tmpFile } })).rejects.toThrow(
          "process.exit:1",
        );
      });

      exit.mockRestore();
      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("error");
      expect(parsed.error.code).toBe("invalid_depends_on");
    });

    it("rejects PRD with no tasks", async () => {
      setJsonMode(true);
      const { prdCommand } = await import("#/cli/commands/prds");
      const loadCommand = await getSubCommand(prdCommand, "load");

      const payload = { title: "Empty PRD", ready: false, tasks: [] };
      await fs.writeFile(tmpFile, JSON.stringify(payload));

      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: string | number | null,
      ) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

      const output = await captureStdout(async () => {
        await expect(loadCommand.run({ args: { file: tmpFile } })).rejects.toThrow(
          "process.exit:1",
        );
      });

      exit.mockRestore();
      const parsed = JSON.parse(output.trim());
      expect(parsed.kind).toBe("error");
      expect(parsed.error.code).toBe("validation_error");
    });
  });

  describe("review commands", () => {
    it("review begin moves a review to in_progress", async () => {
      const { reviewCommand } = await import("#/cli/commands/reviews");
      const beginCommand = await getSubCommand(reviewCommand, "begin");

      const prd = await createPrd(db, { projectId, title: "Review PRD" });
      const { createReview, getReview } = await import("#/lib/workflow");
      const review = await createReview(db, { prdRevisionId: prd.id, type: "human" });

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await beginCommand.run({ args: { reviewId: review.id } });
      output.mockRestore();

      const updated = await getReview(db, review.id);
      expect(updated!.status).toBe("in_progress");
    });

    it("review update stores user feedback", async () => {
      const { reviewCommand } = await import("#/cli/commands/reviews");
      const updateCommand = await getSubCommand(reviewCommand, "update");

      const prd = await createPrd(db, { projectId, title: "Review PRD" });
      const { createReview, getReview } = await import("#/lib/workflow");
      const review = await createReview(db, { prdRevisionId: prd.id, type: "human" });

      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await updateCommand.run({
        args: { reviewId: review.id, feedback: "Please simplify onboarding" },
      });
      output.mockRestore();

      const updated = await getReview(db, review.id);
      expect(updated!.userFeedback).toBe("Please simplify onboarding");
    });
  });
});
