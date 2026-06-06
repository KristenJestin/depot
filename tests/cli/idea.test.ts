import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { Db } from "#/services/database";
import { addWorkspace, createProject, createPrd } from "#/lib/workflow";
import { setJsonMode } from "#/shared/logger";
import {
  createIdea,
  getIdea,
  listIdeas,
  listPrdIdeas,
  linkIdeaToPrd,
} from "#/modules/ideas/domain";

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
  run: (ctx: { args: Record<string, unknown>; ws?: unknown }) => Promise<void> | void;
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

const runP = <A>(db: Database, effect: Effect.Effect<A, any, Db>): Promise<A> =>
  Effect.runPromise(Effect.provideService(effect, Db, db));

describe("idea CLI (PRD 0027 / T2-T4)", () => {
  let db: Database;
  let projectId: string;
  let workspace: { id: string; projectId: string };
  let prdRevisionId: string;
  let prdLogicalId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;

    const project = await createProject(db, { name: "ideas" });
    projectId = project.id;
    workspace = (await addWorkspace(db, {
      projectId,
      path: "/workspace/ideas",
    })) as { id: string; projectId: string };
    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);

    const prd = await createPrd(db, { projectId, title: "Existing PRD" });
    prdRevisionId = prd.id;
    prdLogicalId = prd.prdId;
  });

  afterEach(() => {
    setJsonMode(false);
  });

  // ── add ──────────────────────────────────────────────────────────────────────

  it("`idea add` captures a title (+ --body, --tag) and logs idea_created", async () => {
    const { ideaCommand } = await import("#/cli/commands/idea");
    const add = await getSubCommand(ideaCommand, "add");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await add.run({
      args: { title: "Add dark mode", body: "Users keep asking", tag: "ui" },
      ws: workspace,
    });
    spy.mockRestore();

    const ideas = await runP(db, listIdeas(projectId));
    expect(ideas.map((i) => i.title)).toEqual(["Add dark mode"]);
    expect(ideas[0]!.body).toBe("Users keep asking");
    expect(ideas[0]!.tag).toBe("ui");
    expect(ideas[0]!.status).toBe("open");

    const events = await db.query.activityLog.findMany({});
    expect(events.some((e) => e.eventType === "idea_created")).toBe(true);
  });

  it("`idea add --body-file -` reads the body from stdin", async () => {
    const { ideaCommand } = await import("#/cli/commands/idea");
    const add = await getSubCommand(ideaCommand, "add");

    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    async function* gen() {
      yield Buffer.from("captured from stdin");
    }
    Object.defineProperty(process, "stdin", { value: gen(), configurable: true });

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await add.run({ args: { title: "From stdin", bodyFile: "-" }, ws: workspace });
    } finally {
      spy.mockRestore();
      if (original) Object.defineProperty(process, "stdin", original);
    }

    const ideas = await runP(db, listIdeas(projectId));
    expect(ideas[0]!.title).toBe("From stdin");
    expect(ideas[0]!.body).toBe("captured from stdin");
  });

  // ── list ───────────────────────────────────────────────────────────────────

  it("`idea list --json` returns items and the open count footer", async () => {
    await runP(db, createIdea({ projectId, title: "One" }));
    await runP(db, createIdea({ projectId, title: "Two", tag: "plugins" }));

    const { ideaCommand } = await import("#/cli/commands/idea");
    const list = await getSubCommand(ideaCommand, "list");
    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await list.run({ args: {}, ws: workspace });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      kind: string;
      payload: { items: Array<{ title: string }>; openCount: number };
    };
    expect(env.kind).toBe("success");
    expect(env.payload.items.map((i) => i.title)).toEqual(["Two", "One"]);
    expect(env.payload.openCount).toBe(2);
  });

  it("`idea list` (text) prints an `N open` footer line", async () => {
    await runP(db, createIdea({ projectId, title: "One" }));
    await runP(db, createIdea({ projectId, title: "Two" }));

    const { ideaCommand } = await import("#/cli/commands/idea");
    const list = await getSubCommand(ideaCommand, "list");
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });
    await list.run({ args: {}, ws: workspace });
    spy.mockRestore();
    const joined = logs.join("\n");
    expect(joined).toContain("Two");
    expect(joined).toContain("One");
    expect(joined).toContain("2 open");
  });

  it("`idea list --status promoted` filters by status", async () => {
    await runP(db, createIdea({ projectId, title: "Open one" }));
    const { ideaCommand } = await import("#/cli/commands/idea");
    const list = await getSubCommand(ideaCommand, "list");
    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await list.run({ args: { status: "promoted" }, ws: workspace });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as { payload: { items: unknown[] } };
    expect(env.payload.items).toHaveLength(0);
  });

  // ── show ───────────────────────────────────────────────────────────────────

  it("`idea show` prints body + status (text)", async () => {
    const idea = await runP(db, createIdea({ projectId, title: "Showable", body: "Body text" }));
    const { ideaCommand } = await import("#/cli/commands/idea");
    const show = await getSubCommand(ideaCommand, "show");
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });
    await show.run({ args: { id: idea.id }, ws: workspace });
    spy.mockRestore();
    const joined = logs.join("\n");
    expect(joined).toContain("Body text");
    expect(joined).toContain("open");
  });

  it("`idea show` errors on unknown id (exit 1)", async () => {
    const { ideaCommand } = await import("#/cli/commands/idea");
    const show = await getSubCommand(ideaCommand, "show");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await show.run({ args: { id: "NOPE" }, ws: workspace });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  // ── edit ───────────────────────────────────────────────────────────────────

  it("`idea edit` updates in place and logs idea_updated", async () => {
    const idea = await runP(db, createIdea({ projectId, title: "Old" }));
    const { ideaCommand } = await import("#/cli/commands/idea");
    const edit = await getSubCommand(ideaCommand, "edit");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await edit.run({ args: { id: idea.id, title: "New", body: "Now with body" }, ws: workspace });
    spy.mockRestore();

    const after = await runP(db, getIdea(idea.id));
    expect(after.title).toBe("New");
    expect(after.body).toBe("Now with body");

    const events = await db.query.activityLog.findMany({});
    expect(events.some((e) => e.eventType === "idea_updated")).toBe(true);
  });

  // ── drop / reopen ────────────────────────────────────────────────────────────

  it("`idea drop` then `idea reopen` round-trips status and logs events", async () => {
    const idea = await runP(db, createIdea({ projectId, title: "Maybe" }));
    const { ideaCommand } = await import("#/cli/commands/idea");
    const drop = await getSubCommand(ideaCommand, "drop");
    const reopen = await getSubCommand(ideaCommand, "reopen");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await drop.run({ args: { id: idea.id, reason: "not now" }, ws: workspace });
    spy.mockRestore();
    expect((await runP(db, getIdea(idea.id))).status).toBe("dropped");

    const spy2 = vi.spyOn(console, "log").mockImplementation(() => {});
    await reopen.run({ args: { id: idea.id }, ws: workspace });
    spy2.mockRestore();
    expect((await runP(db, getIdea(idea.id))).status).toBe("open");

    const events = await db.query.activityLog.findMany({});
    expect(events.some((e) => e.eventType === "idea_dropped")).toBe(true);
    expect(events.some((e) => e.eventType === "idea_reopened")).toBe(true);
  });

  // ── promote ──────────────────────────────────────────────────────────────────

  it("`idea promote` creates a draft PRD, prints its id, flips status, logs both events", async () => {
    const idea = await runP(db, createIdea({ projectId, title: "Becomes a PRD", tag: "plugins" }));
    const { ideaCommand } = await import("#/cli/commands/idea");
    const promote = await getSubCommand(ideaCommand, "promote");

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });
    await promote.run({ args: { id: idea.id }, ws: workspace });
    spy.mockRestore();

    const after = await runP(db, getIdea(idea.id));
    expect(after.status).toBe("promoted");
    expect(after.promotedPrdId).not.toBeNull();

    const joined = logs.join("\n");
    expect(joined).toContain(after.promotedPrdId!);

    const events = await db.query.activityLog.findMany({});
    expect(events.some((e) => e.eventType === "idea_promoted")).toBe(true);
    expect(events.some((e) => e.eventType === "prd_created")).toBe(true);

    const linked = await runP(db, listPrdIdeas(after.promotedPrdId!));
    expect(linked.map((i) => i.id)).toEqual([idea.id]);
  });

  it("`idea promote --json` returns { idea, prd }", async () => {
    const idea = await runP(db, createIdea({ projectId, title: "JSON promote" }));
    const { ideaCommand } = await import("#/cli/commands/idea");
    const promote = await getSubCommand(ideaCommand, "promote");
    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await promote.run({ args: { id: idea.id }, ws: workspace });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      kind: string;
      payload: { idea: { status: string }; prd: { prdId: string; title: string } };
    };
    expect(env.kind).toBe("success");
    expect(env.payload.idea.status).toBe("promoted");
    expect(env.payload.prd.title).toBe("JSON promote");
  });

  it("`idea promote` on a non-open idea errors (exit 1)", async () => {
    const idea = await runP(db, createIdea({ projectId, title: "Drop me first" }));
    const { ideaCommand } = await import("#/cli/commands/idea");
    const drop = await getSubCommand(ideaCommand, "drop");
    const dropSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await drop.run({ args: { id: idea.id }, ws: workspace });
    dropSpy.mockRestore();

    const promote = await getSubCommand(ideaCommand, "promote");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await promote.run({ args: { id: idea.id }, ws: workspace });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  // ── prd idea add/remove/list ──────────────────────────────────────────────────

  it("`prd idea add` links a source idea (idempotent) and `list` returns it", async () => {
    const idea = await runP(db, createIdea({ projectId, title: "Source idea" }));
    const { prdCommand } = await import("#/cli/commands/prds");
    const ideaGroup = await getSubCommand(prdCommand, "idea");
    const add = await getSubCommand(ideaGroup as unknown as { subCommands: unknown }, "add");
    const list = await getSubCommand(ideaGroup as unknown as { subCommands: unknown }, "list");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await add.run({ args: { prdId: prdRevisionId, ideaId: idea.id }, ws: workspace });
    await add.run({ args: { prdId: prdRevisionId, ideaId: idea.id }, ws: workspace });
    spy.mockRestore();

    const links = await runP(db, listPrdIdeas(prdLogicalId));
    expect(links.map((i) => i.id)).toEqual([idea.id]);
    expect((await runP(db, getIdea(idea.id))).status).toBe("open");

    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await list.run({ args: { prdId: prdRevisionId }, ws: workspace });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as { payload: { items: Array<{ id: string }> } };
    expect(env.payload.items.map((i) => i.id)).toEqual([idea.id]);
  });

  it("`prd idea remove` unlinks the idea", async () => {
    const idea = await runP(db, createIdea({ projectId, title: "To unlink" }));
    await runP(db, linkIdeaToPrd(prdRevisionId, idea.id));

    const { prdCommand } = await import("#/cli/commands/prds");
    const ideaGroup = await getSubCommand(prdCommand, "idea");
    const remove = await getSubCommand(ideaGroup as unknown as { subCommands: unknown }, "remove");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await remove.run({ args: { prdId: prdRevisionId, ideaId: idea.id }, ws: workspace });
    spy.mockRestore();

    expect(await runP(db, listPrdIdeas(prdLogicalId))).toHaveLength(0);
  });

  it("`prd idea add` errors on unknown idea (exit 1)", async () => {
    const { prdCommand } = await import("#/cli/commands/prds");
    const ideaGroup = await getSubCommand(prdCommand, "idea");
    const add = await getSubCommand(ideaGroup as unknown as { subCommands: unknown }, "add");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await add.run({ args: { prdId: prdRevisionId, ideaId: "NOPE" }, ws: workspace });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
