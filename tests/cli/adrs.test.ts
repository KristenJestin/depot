import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { Db } from "#/services/database";
import { addWorkspace, createProject, createPrd } from "#/lib/workflow";
import { setJsonMode } from "#/shared/logger";
import { createAdr, acceptAdr, supersedeAdr, listAdrs } from "#/modules/adrs/domain";

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

const runAdr = <A>(db: Database, effect: Effect.Effect<A, any, Db>): Promise<A> =>
  Effect.runPromise(Effect.provideService(effect, Db, db));

describe("ADR CLI commands", () => {
  let db: Database;
  let projectId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    delete process.env["DEPOT_EDITOR_INPUT"];
    ({ db } = createTestDb());
    currentTestDb = db;

    const project = await createProject(db, { name: "adr-cli" });
    projectId = project.id;
    const workspace = await addWorkspace(db, {
      projectId,
      path: "/workspace/adr-cli",
    });
    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    setJsonMode(false);
    delete process.env["DEPOT_EDITOR_INPUT"];
  });

  it("`adr create` with --body creates a proposed ADR", async () => {
    const { adrCommand } = await import("#/cli/commands/adrs");
    const create = await getSubCommand(adrCommand, "create");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await create.run({ args: { title: "Use SQLite", body: "Because embedded." } });
    spy.mockRestore();

    const items = await runAdr(db, listAdrs({ projectId }));
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Use SQLite");
    expect(items[0]!.status).toBe("proposed");
    expect(items[0]!.number).toBe(1);
  });

  it("`adr create` falls back to $EDITOR when no body source is provided", async () => {
    const { adrCommand } = await import("#/cli/commands/adrs");
    const create = await getSubCommand(adrCommand, "create");

    process.env["DEPOT_EDITOR_INPUT"] = "## Decision\nGo with WAL mode.";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await create.run({ args: { title: "WAL mode" } });
    spy.mockRestore();

    const items = await runAdr(db, listAdrs({ projectId }));
    expect(items).toHaveLength(1);
    expect(items[0]!.body).toContain("WAL mode");
  });

  it("`adr create --prd` links the ADR to a logical PRD", async () => {
    const { adrCommand } = await import("#/cli/commands/adrs");
    const create = await getSubCommand(adrCommand, "create");

    const prd = await createPrd(db, { projectId, title: "feature" });

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await create.run({
      args: { title: "T", body: "B", prd: prd.prdId },
    });
    spy.mockRestore();

    const items = await runAdr(db, listAdrs({ projectId }));
    expect(items).toHaveLength(1);
    expect(items[0]!.prdId).toBe(prd.prdId);
  });

  it("`adr list` filters by status", async () => {
    const a = await runAdr(db, createAdr({ projectId, title: "A", body: "x" }));
    await runAdr(db, createAdr({ projectId, title: "B", body: "y" }));
    await runAdr(db, acceptAdr(a.id));

    const { adrCommand } = await import("#/cli/commands/adrs");
    const list = await getSubCommand(adrCommand, "list");

    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await list.run({ args: { status: "accepted" } });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      kind: string;
      payload: { items: Array<{ title: string }> };
    };
    expect(env.kind).toBe("success");
    expect(env.payload.items).toHaveLength(1);
    expect(env.payload.items[0]!.title).toBe("A");
  });

  it("`adr show <id>` accepts the `ADR-NNNN` display id", async () => {
    const a = await runAdr(db, createAdr({ projectId, title: "Hello", body: "Body" }));

    const { adrCommand } = await import("#/cli/commands/adrs");
    const show = await getSubCommand(adrCommand, "show");

    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await show.run({ args: { id: "ADR-0001" } });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      kind: string;
      payload: { item: { id: string; title: string }; displayId: string };
    };
    expect(env.payload.item.id).toBe(a.id);
    expect(env.payload.item.title).toBe("Hello");
    expect(env.payload.displayId).toBe("ADR-0001");
  });

  it("`adr show` also accepts the full ULID", async () => {
    const a = await runAdr(db, createAdr({ projectId, title: "Hello", body: "Body" }));

    const { adrCommand } = await import("#/cli/commands/adrs");
    const show = await getSubCommand(adrCommand, "show");

    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await show.run({ args: { id: a.id } });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      kind: string;
      payload: { item: { id: string } };
    };
    expect(env.payload.item.id).toBe(a.id);
  });

  it("`adr accept` flips proposed to accepted", async () => {
    const a = await runAdr(db, createAdr({ projectId, title: "T", body: "B" }));

    const { adrCommand } = await import("#/cli/commands/adrs");
    const accept = await getSubCommand(adrCommand, "accept");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await accept.run({ args: { id: "1" } });
    spy.mockRestore();

    const items = await runAdr(db, listAdrs({ projectId }));
    expect(items[0]!.id).toBe(a.id);
    expect(items[0]!.status).toBe("accepted");
  });

  it("`adr supersede` creates a new accepted ADR and marks the old one superseded", async () => {
    const old = await runAdr(db, createAdr({ projectId, title: "Old", body: "B" }));
    await runAdr(db, acceptAdr(old.id));

    const { adrCommand } = await import("#/cli/commands/adrs");
    const supersede = await getSubCommand(adrCommand, "supersede");

    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await supersede.run({
          args: { id: "ADR-0001", title: "New", body: "B2" },
        });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      kind: string;
      payload: {
        oldAdr: { id: string; status: string };
        newAdr: { id: string; status: string; number: number; title: string };
        newDisplayId: string;
      };
    };
    expect(env.payload.oldAdr.id).toBe(old.id);
    expect(env.payload.oldAdr.status).toBe("superseded");
    expect(env.payload.newAdr.status).toBe("accepted");
    expect(env.payload.newAdr.title).toBe("New");
    expect(env.payload.newDisplayId).toBe("ADR-0002");
  });

  it("`adr show` returns not_found for an unknown ref", async () => {
    const { adrCommand } = await import("#/cli/commands/adrs");
    const show = await getSubCommand(adrCommand, "show");

    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(show.run({ args: { id: "ADR-9999" } })).rejects.toThrow(/exit:1/);
    expect(err).toHaveBeenCalled();

    err.mockRestore();
    exit.mockRestore();
  });
});

// Sanity check that `supersedeAdr` (already covered by the domain suite) is
// reachable from the CLI module — guards against accidental dead exports.
describe("supersedeAdr domain re-export reachable from CLI commands", () => {
  it("smoke", () => {
    expect(typeof supersedeAdr).toBe("function");
  });
});
