/**
 * PRD 0017 / T5 — `depot project directive update <id>` CLI.
 *
 * Covers:
 *   (a) update --title only             → success, row updated, activity_log
 *                                          contains `directive_updated` with
 *                                          `changes.title`.
 *   (b) update --category --scope valid → success, row updated.
 *   (c) update (category, scope) invalid → exit ≠ 0, stderr lists valid scopes.
 *   (d) update on missing id            → exit ≠ 0, clear message.
 *   (e) update with no flags            → exit ≠ 0, "nothing to update".
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { Db } from "#/services/database";
import { addWorkspace, createProject } from "#/lib/workflow";
import { setJsonMode } from "#/shared/logger";
import { createDirective, getDirective } from "#/modules/projects/directives";
import { listActivity } from "#/modules/activity/domain";

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

describe("project directive update (PRD 0017 / T5)", () => {
  let db: Database;
  let projectId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;
    const project = await createProject(db, { name: "directive-update-cli" });
    projectId = project.id;
    const workspace = await addWorkspace(db, {
      projectId,
      path: "/workspace/directive-update-cli",
    });
    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    setJsonMode(false);
  });

  async function seedDirective(overrides: { scope?: string; category?: string; title?: string }) {
    return Effect.runPromise(
      Effect.provideService(
        createDirective({
          projectId,
          scope: (overrides.scope ?? "pre-review") as "pre-review",
          category: (overrides.category ?? "dev") as "dev",
          kind: "rule",
          title: overrides.title ?? "Initial",
          instruction: "noop",
        }),
        Db,
        db,
      ),
    );
  }

  it("(a) updates only --title and logs directive_updated with changes.title", async () => {
    const seeded = await seedDirective({ title: "Old title" });
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const updateCmd = await getSubCommand(directiveCmd, "update");
    setJsonMode(true);

    const out = await captureStdout(async () => {
      await updateCmd.run({
        args: {
          id: seeded.id,
          title: "New title",
        },
      });
    });

    const parsed = JSON.parse(out.trim()) as {
      kind: string;
      payload: {
        item: { title: string };
        changes: Record<string, { from: unknown; to: unknown }>;
      };
    };
    expect(parsed.kind).toBe("success");
    expect(parsed.payload.item.title).toBe("New title");
    expect(parsed.payload.changes.title).toEqual({ from: "Old title", to: "New title" });

    const after = await Effect.runPromise(Effect.provideService(getDirective(seeded.id), Db, db));
    expect(after?.title).toBe("New title");

    const entries = await Effect.runPromise(
      Effect.provideService(listActivity({ projectId }), Db, db),
    );
    const updatedEntry = entries.find((e) => e.eventType === "directive_updated");
    expect(updatedEntry).toBeTruthy();
    const payload = JSON.parse(updatedEntry!.payload) as {
      directiveId: string;
      changes: Record<string, { from: unknown; to: unknown }>;
    };
    expect(payload.directiveId).toBe(seeded.id);
    expect(payload.changes.title).toEqual({ from: "Old title", to: "New title" });
  });

  it("(b) updates both --category and --scope when the combination is valid", async () => {
    const seeded = await seedDirective({ scope: "pre-review", category: "dev" });
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const updateCmd = await getSubCommand(directiveCmd, "update");
    setJsonMode(true);

    const out = await captureStdout(async () => {
      await updateCmd.run({
        args: {
          id: seeded.id,
          category: "auditor",
          scope: "pre-review",
        },
      });
    });

    const parsed = JSON.parse(out.trim()) as {
      kind: string;
      payload: {
        item: { category: string; scope: string };
        changes: Record<string, { from: unknown; to: unknown }>;
      };
    };
    expect(parsed.kind).toBe("success");
    expect(parsed.payload.item.category).toBe("auditor");
    expect(parsed.payload.item.scope).toBe("pre-review");
    expect(parsed.payload.changes.category).toEqual({ from: "dev", to: "auditor" });
    // `scope` did not change so it should NOT be in the diff.
    expect(parsed.payload.changes.scope).toBeUndefined();

    const after = await Effect.runPromise(Effect.provideService(getDirective(seeded.id), Db, db));
    expect(after?.category).toBe("auditor");
  });

  it("(c) rejects an invalid (category, scope) combination and lists valid scopes", async () => {
    const seeded = await seedDirective({ scope: "pre-review", category: "dev" });
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const updateCmd = await getSubCommand(directiveCmd, "update");
    const exit = expectProcessExit();

    const stderr = await captureConsoleError(async () => {
      await expect(
        updateCmd.run({
          args: {
            id: seeded.id,
            category: "doc",
            scope: "post-auditor-pass",
          },
        }),
      ).rejects.toThrow("process.exit:1");
    });
    expect(stderr).toMatch(/doc/);
    expect(stderr).toMatch(/post-auditor-pass/);
    expect(stderr).toMatch(/always/);
    expect(stderr).toMatch(/pre-doc-sync/);

    const after = await Effect.runPromise(Effect.provideService(getDirective(seeded.id), Db, db));
    expect(after?.category).toBe("dev");
    expect(after?.scope).toBe("pre-review");

    exit.mockRestore();
  });

  it("(d) errors when the directive id does not exist", async () => {
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const updateCmd = await getSubCommand(directiveCmd, "update");
    const exit = expectProcessExit();

    const stderr = await captureConsoleError(async () => {
      await expect(
        updateCmd.run({
          args: {
            id: "dir-does-not-exist",
            title: "anything",
          },
        }),
      ).rejects.toThrow("process.exit:1");
    });
    expect(stderr).toMatch(/Directive not found/i);
    expect(stderr).toMatch(/dir-does-not-exist/);

    exit.mockRestore();
  });

  it("(e) errors with 'nothing to update' when no editable flag is provided", async () => {
    const seeded = await seedDirective({});
    const { projectCommand } = await import("#/cli/commands/projects");
    const directiveCmd = await getSubCommand(projectCommand, "directive");
    const updateCmd = await getSubCommand(directiveCmd, "update");
    const exit = expectProcessExit();

    const stderr = await captureConsoleError(async () => {
      await expect(
        updateCmd.run({
          args: {
            id: seeded.id,
          },
        }),
      ).rejects.toThrow("process.exit:1");
    });
    expect(stderr).toMatch(/Nothing to update/i);

    const entries = await Effect.runPromise(
      Effect.provideService(listActivity({ projectId }), Db, db),
    );
    const updatedEntry = entries.find((e) => e.eventType === "directive_updated");
    expect(updatedEntry).toBeFalsy();

    exit.mockRestore();
  });
});
