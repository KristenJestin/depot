/**
 * PRD 0013 / T6 — `--category` is a required flag on `depot project directive add`.
 *
 * Covers:
 *   (a) `--category` absent           → exit ≠ 0, error lists allowed categories.
 *   (b) `--category <invalid>`         → exit ≠ 0, error lists allowed values.
 *   (c) `(category, scope)` invalid    → exit ≠ 0, error lists valid scopes for that category.
 *   (d) valid combination              → directive created, `category` persisted.
 *
 * Also: (e) `depot project directive list --category` filters to the matching rows.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { Db } from "#/services/database";
import { addWorkspace, createProject } from "#/lib/workflow";
import { setJsonMode } from "#/shared/logger";
import { listDirectives } from "#/modules/projects/directives";

const resolveCurrentWorkspace =
  vi.fn<() => Promise<{ db: Database; ws: unknown; currentRepo?: unknown }>>();
const getDb = vi.fn<() => Promise<Database>>();

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
  subCommands?: unknown;
};

async function getSubCommand(command: { subCommands?: unknown }, name: string) {
  const subCommands = await command.subCommands;
  if (!subCommands || typeof subCommands !== "object" || !(name in subCommands)) {
    throw new Error(`Subcommand not found: ${name}`);
  }
  return (subCommands as Record<string, RunnableSubCommand>)[name]!;
}

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

function expectProcessExit() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never);
}

describe("project directive add --category (PRD 0013 / T6)", () => {
  let db: Database;
  let projectId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;
    const project = await createProject(db, { name: "directive-cli" });
    projectId = project.id;
    const workspace = await addWorkspace(db, {
      projectId,
      path: "/workspace/directive-cli",
    });
    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    setJsonMode(false);
  });

  it("(a) errors when --category is absent and lists allowed categories", async () => {
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const addCmd = await getSubCommand(directiveCmd, "add");
    const exit = expectProcessExit();

    const stderr = await captureConsoleError(async () => {
      await expect(
        addCmd.run({
          args: {
            scope: "always",
            kind: "rule",
            title: "Be polite",
            instruction: "always be polite",
            nonBlocking: false,
          },
        }),
      ).rejects.toThrow("process.exit:1");
    });
    expect(stderr).toMatch(/--category/);
    expect(stderr).toMatch(/prd/);
    expect(stderr).toMatch(/dev/);
    expect(stderr).toMatch(/coder/);
    expect(stderr).toMatch(/auditor/);
    expect(stderr).toMatch(/doc/);
    expect(stderr).toMatch(/ship/);

    const rows = await Effect.runPromise(Effect.provideService(listDirectives(projectId), Db, db));
    expect(rows).toHaveLength(0);

    exit.mockRestore();
  });

  it("(b) errors when --category has an unknown value and lists allowed values", async () => {
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const addCmd = await getSubCommand(directiveCmd, "add");
    const exit = expectProcessExit();

    const stderr = await captureConsoleError(async () => {
      await expect(
        addCmd.run({
          args: {
            scope: "always",
            category: "frontend",
            kind: "rule",
            title: "Bad category",
            instruction: "noop",
            nonBlocking: false,
          },
        }),
      ).rejects.toThrow("process.exit:1");
    });
    expect(stderr).toMatch(/--category/);
    expect(stderr).toMatch(/frontend/);
    expect(stderr).toMatch(/prd/);
    expect(stderr).toMatch(/dev/);
    expect(stderr).toMatch(/coder/);
    expect(stderr).toMatch(/auditor/);
    expect(stderr).toMatch(/doc/);
    expect(stderr).toMatch(/ship/);

    const rows = await Effect.runPromise(Effect.provideService(listDirectives(projectId), Db, db));
    expect(rows).toHaveLength(0);

    exit.mockRestore();
  });

  it("(c) errors when (category, scope) is invalid and lists valid scopes for that category", async () => {
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const addCmd = await getSubCommand(directiveCmd, "add");
    const exit = expectProcessExit();

    // `doc` category is only valid for `always` and `pre-doc-sync`. Try
    // `pre-ship` and verify the error names the valid scopes.
    const stderr = await captureConsoleError(async () => {
      await expect(
        addCmd.run({
          args: {
            scope: "pre-ship",
            category: "doc",
            kind: "rule",
            title: "Wrong scope",
            instruction: "noop",
            nonBlocking: false,
          },
        }),
      ).rejects.toThrow("process.exit:1");
    });
    expect(stderr).toMatch(/doc/);
    expect(stderr).toMatch(/pre-ship/);
    expect(stderr).toMatch(/always/);
    expect(stderr).toMatch(/pre-doc-sync/);

    const rows = await Effect.runPromise(Effect.provideService(listDirectives(projectId), Db, db));
    expect(rows).toHaveLength(0);

    exit.mockRestore();
  });

  it("(d) creates a directive with category persisted when the combination is valid", async () => {
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const addCmd = await getSubCommand(directiveCmd, "add");
    setJsonMode(true);

    const out = await captureStdout(async () => {
      await addCmd.run({
        args: {
          scope: "pre-commit",
          category: "coder",
          kind: "rule",
          title: "Run formatter",
          instruction: "format before committing",
          nonBlocking: false,
        },
      });
    });

    const parsed = JSON.parse(out.trim()) as {
      kind: string;
      payload: { item: { category: string; scope: string; title: string } };
    };
    expect(parsed.kind).toBe("success");
    expect(parsed.payload.item.category).toBe("coder");
    expect(parsed.payload.item.scope).toBe("pre-commit");
    expect(parsed.payload.item.title).toBe("Run formatter");

    const rows = await Effect.runPromise(Effect.provideService(listDirectives(projectId), Db, db));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("coder");
    expect(rows[0]!.scope).toBe("pre-commit");
  });
});

describe("project directive list --category (PRD 0013 / T6)", () => {
  let db: Database;
  let projectId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;
    const project = await createProject(db, { name: "directive-list-cli" });
    projectId = project.id;
    const workspace = await addWorkspace(db, {
      projectId,
      path: "/workspace/directive-list-cli",
    });
    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    setJsonMode(false);
  });

  it("(e) returns only directives of the requested category", async () => {
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const addCmd = await getSubCommand(directiveCmd, "add");
    const listCmd = await getSubCommand(directiveCmd, "list");

    setJsonMode(true);
    await captureStdout(async () => {
      await addCmd.run({
        args: {
          scope: "always",
          category: "dev",
          kind: "rule",
          title: "dev always",
          instruction: "ok",
          nonBlocking: false,
        },
      });
      await addCmd.run({
        args: {
          scope: "always",
          category: "coder",
          kind: "rule",
          title: "coder always",
          instruction: "ok",
          nonBlocking: false,
        },
      });
      await addCmd.run({
        args: {
          scope: "pre-commit",
          category: "coder",
          kind: "rule",
          title: "coder pre-commit",
          instruction: "ok",
          nonBlocking: false,
        },
      });
    });

    const out = await captureStdout(async () => {
      await listCmd.run({
        args: {
          category: "coder",
          enabledOnly: false,
        },
      });
    });

    const parsed = JSON.parse(out.trim()) as {
      kind: string;
      payload: { items: Array<{ title: string; category: string }> };
    };
    expect(parsed.kind).toBe("success");
    expect(parsed.payload.items.map((d) => d.title).sort()).toEqual([
      "coder always",
      "coder pre-commit",
    ]);
    for (const item of parsed.payload.items) {
      expect(item.category).toBe("coder");
    }
  });
});
