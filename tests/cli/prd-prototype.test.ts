import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { Db } from "#/services/database";
import { addWorkspace, createProject, createPrd } from "#/lib/workflow";
import { setJsonMode } from "#/shared/logger";
import {
  addFeedback,
  addPage,
  addVariant,
  addVersion,
  createPrototype,
  createRound,
  getCurrentRound,
  getRoundPagePlacement,
  listFeedbacks,
  listPrototypes,
  listRoundPages,
  listRounds,
  listVariants,
  resolveFeedback,
} from "#/modules/prds/prototypes";

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

const runP = <A>(db: Database, effect: Effect.Effect<A, any, Db>): Promise<A> =>
  Effect.runPromise(Effect.provideService(effect, Db, db));

describe("prd prototype CLI (PRD 0025 / T1)", () => {
  let db: Database;
  let projectId: string;
  let prdRevisionId: string;
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;
    tmpDir = mkdtempSync(join(tmpdir(), "depot-proto-cli-"));

    const project = await createProject(db, { name: "proto" });
    projectId = project.id;
    const workspace = await addWorkspace(db, { projectId, path: "/workspace/proto" });
    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);

    const prd = await createPrd(db, { projectId, title: "Feature" });
    prdRevisionId = prd.id;
  });

  afterEach(() => {
    setJsonMode(false);
  });

  it("`prototype create` adds a row and reports the id", async () => {
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const create = await getSubCommand(prototypeCommand, "create");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await create.run({ args: { prdId: prdRevisionId, slug: "jobs", description: "x" } });
    spy.mockRestore();
    const items = await runP(db, listPrototypes(prdRevisionId));
    expect(items.map((p) => p.slug)).toEqual(["jobs"]);
  });

  it("`prototype create` errors on unknown PRD", async () => {
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const create = await getSubCommand(prototypeCommand, "create");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await create.run({ args: { prdId: "NOPE", slug: "x" } });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("`prototype list` --json returns items", async () => {
    await runP(db, createPrototype({ prdRevisionId, slug: "jobs" }));
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const list = await getSubCommand(prototypeCommand, "list");
    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await list.run({ args: { prdId: prdRevisionId } });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      kind: string;
      payload: { items: Array<{ slug: string }> };
    };
    expect(env.kind).toBe("success");
    expect(env.payload.items[0]!.slug).toBe("jobs");
  });

  it("`prototype show` prints the tree", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const show = await getSubCommand(prototypeCommand, "show");
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });
    await show.run({ args: { prototypeId: proto.id } });
    spy.mockRestore();
    const joined = logs.join("\n");
    expect(joined).toContain("Prototype: p");
    expect(joined).toContain("Page: home");
    expect(joined).toContain("Variant rail [main]");
  });

  it("`prototype archive` errors when unknown", async () => {
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const archive = await getSubCommand(prototypeCommand, "archive");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await archive.run({ args: { prototypeId: "NOPE" } });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("`prototype page add` creates a row", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const pageCmd = await getSubCommand(prototypeCommand, "page");
    const add = await getSubCommand(pageCmd as unknown as { subCommands: unknown }, "add");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await add.run({ args: { prototypeId: proto.id, slug: "home", title: "Home" } });
    spy.mockRestore();
    const pages = await db.query.prdPrototypePages.findMany({ where: { prototypeId: proto.id } });
    expect(pages.map((p) => p.slug)).toEqual(["home"]);
  });

  it("`prototype page add` rejects an invalid slug", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const pageCmd = await getSubCommand(prototypeCommand, "page");
    const add = await getSubCommand(pageCmd as unknown as { subCommands: unknown }, "add");
    await expect(
      add.run({ args: { prototypeId: proto.id, slug: "Bad Slug", title: "X" } }),
    ).rejects.toThrow(/kebab-case/);
  });

  it("`prototype version add` + `archive` + `restore` round-trip", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const versionCmd = await getSubCommand(prototypeCommand, "version");
    const add = await getSubCommand(versionCmd as unknown as { subCommands: unknown }, "add");
    const archive = await getSubCommand(
      versionCmd as unknown as { subCommands: unknown },
      "archive",
    );
    const restore = await getSubCommand(
      versionCmd as unknown as { subCommands: unknown },
      "restore",
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await add.run({ args: { pageId: page.id, label: "v1" } });
    spy.mockRestore();

    const versions = await db.query.prdPrototypePageVersions.findMany({
      where: { pageId: page.id },
    });
    expect(versions).toHaveLength(1);
    const v = versions[0]!;

    const spy2 = vi.spyOn(console, "log").mockImplementation(() => {});
    await archive.run({ args: { versionId: v.id } });
    spy2.mockRestore();
    const archived = await db.query.prdPrototypePageVersions.findFirst({ where: { id: v.id } });
    expect(archived?.archivedAt).toBeInstanceOf(Date);

    const spy3 = vi.spyOn(console, "log").mockImplementation(() => {});
    await restore.run({ args: { versionId: v.id } });
    spy3.mockRestore();
    const restored = await db.query.prdPrototypePageVersions.findFirst({ where: { id: v.id } });
    expect(restored?.archivedAt).toBeNull();
  });

  it("`prototype version add` errors on unknown page", async () => {
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const versionCmd = await getSubCommand(prototypeCommand, "version");
    const add = await getSubCommand(versionCmd as unknown as { subCommands: unknown }, "add");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await add.run({ args: { pageId: "NOPE", label: "v1" } });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("`prototype variant add --file` reads HTML from disk", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const htmlPath = join(tmpDir, "rail.html");
    writeFileSync(htmlPath, "<!doctype html><body><p>rail</p></body>");

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const variantCmd = await getSubCommand(prototypeCommand, "variant");
    const add = await getSubCommand(variantCmd as unknown as { subCommands: unknown }, "add");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await add.run({
      args: { versionId: v1.id, label: "rail", title: "Rail", file: htmlPath },
    });
    spy.mockRestore();
    const variants = await runP(db, listVariants(v1.id));
    expect(variants).toHaveLength(1);
    expect(variants[0]!.htmlContent).toContain("<p>rail</p>");
    expect(variants[0]!.isMain).toBe(true);
  });

  it("`prototype variant add --file` errors on missing file", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const variantCmd = await getSubCommand(prototypeCommand, "variant");
    const add = await getSubCommand(variantCmd as unknown as { subCommands: unknown }, "add");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await add.run({
      args: { versionId: v1.id, label: "rail", title: "Rail", file: "/nope/missing" },
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("`prototype variant add` rejects non-self-contained HTML and stores nothing", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const htmlPath = join(tmpDir, "cdn.html");
    writeFileSync(
      htmlPath,
      '<!doctype html>\n<script src="https://cdn.tailwindcss.com"></script>\n<body>x</body>',
    );
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const variantCmd = await getSubCommand(prototypeCommand, "variant");
    const add = await getSubCommand(variantCmd as unknown as { subCommands: unknown }, "add");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await add.run({ args: { versionId: v1.id, label: "cdn", title: "CDN", file: htmlPath } });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(await runP(db, listVariants(v1.id))).toHaveLength(0);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("`prototype variant add --allow-external` stores the variant anyway", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const htmlPath = join(tmpDir, "cdn.html");
    writeFileSync(htmlPath, '<script src="https://cdn.tailwindcss.com"></script><body>x</body>');
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const variantCmd = await getSubCommand(prototypeCommand, "variant");
    const add = await getSubCommand(variantCmd as unknown as { subCommands: unknown }, "add");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await add.run({
      args: { versionId: v1.id, label: "cdn", title: "CDN", file: htmlPath, allowExternal: true },
    });
    spy.mockRestore();
    const variants = await runP(db, listVariants(v1.id));
    expect(variants).toHaveLength(1);
    expect(variants[0]!.htmlContent).toContain("cdn.tailwindcss.com");
  });

  it("`context prototype` with no prototype yet emits a create instruction instead of erroring", async () => {
    const { contextCommand } = await import("#/cli/commands/context");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await contextCommand.run?.({
      rawArgs: [],
      args: { mode: "prototype", prdTarget: prdRevisionId },
      cmd: contextCommand,
    } as any);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    logSpy.mockRestore();
    expect(out).toContain("# Context: Prototype Sub-Agent");
    expect(out).toContain("No prototype exists yet for this PRD");
    expect(out).toContain(`depot prd prototype create ${prdRevisionId} <slug>`);
  });

  it("`prototype variant set-main` flips main atomically", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const tabs = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "tabs",
        title: "Tabs",
        htmlContent: "<p/>",
      }),
    );

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const variantCmd = await getSubCommand(prototypeCommand, "variant");
    const setMain = await getSubCommand(
      variantCmd as unknown as { subCommands: unknown },
      "set-main",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await setMain.run({ args: { variantId: tabs.id } });
    spy.mockRestore();

    const after = await runP(db, listVariants(v1.id));
    expect(after.filter((v) => v.isMain).map((v) => v.label)).toEqual(["tabs"]);
  });

  it("`prototype variant rm` removes a variant", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const rail = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const variantCmd = await getSubCommand(prototypeCommand, "variant");
    const rm = await getSubCommand(variantCmd as unknown as { subCommands: unknown }, "rm");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await rm.run({ args: { variantId: rail.id } });
    spy.mockRestore();

    const after = await runP(db, listVariants(v1.id));
    expect(after).toHaveLength(0);
  });

  it("`prototype feedback list` filters by status (--json)", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const rail = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const fb1 = await runP(db, addFeedback({ variantId: rail.id, text: "a" }));
    const fb2 = await runP(db, addFeedback({ variantId: rail.id, text: "b" }));

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const fbCmd = await getSubCommand(prototypeCommand, "feedback");
    const list = await getSubCommand(fbCmd as unknown as { subCommands: unknown }, "list");

    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await list.run({ args: { prdId: prdRevisionId, status: "open" } });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      payload: { items: Array<{ id: string; status: string }> };
    };
    expect(env.payload.items.map((i) => i.id)).toEqual([fb1.id, fb2.id]);
  });

  it("`prototype feedback resolve` writes resolution_* and keeps status open", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const rail = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const fb = await runP(db, addFeedback({ variantId: rail.id, text: "x" }));

    const v2 = await runP(db, addVersion({ pageId: page.id, label: "v2" }));
    const v2Rail = await runP(
      db,
      addVariant({
        pageVersionId: v2.id,
        label: "rail",
        title: "Rail v2",
        htmlContent: "<p/>",
      }),
    );

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const fbCmd = await getSubCommand(prototypeCommand, "feedback");
    const resolve = await getSubCommand(fbCmd as unknown as { subCommands: unknown }, "resolve");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await resolve.run({
      args: { feedbackId: fb.id, note: "Moved CTA", viaVariant: v2Rail.id },
    });
    spy.mockRestore();

    const after = await db.query.prdPrototypeFeedback.findFirst({ where: { id: fb.id } });
    expect(after?.status).toBe("open");
    expect(after?.resolutionNote).toBe("Moved CTA");
    expect(after?.resolutionViaVariantId).toBe(v2Rail.id);
    expect(after?.resolvedAt).toBeInstanceOf(Date);
  });

  it("`prototype feedback list` shows [resolved] for an annotated-but-open feedback", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const rail = await runP(
      db,
      addVariant({ pageVersionId: v1.id, label: "rail", title: "Rail", htmlContent: "<p/>" }),
    );
    const open = await runP(db, addFeedback({ variantId: rail.id, text: "still open" }));
    const resolved = await runP(db, addFeedback({ variantId: rail.id, text: "addressed" }));
    await runP(db, resolveFeedback(resolved.id, { note: "done", viaVariantId: null }));

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const fbCmd = await getSubCommand(prototypeCommand, "feedback");
    const list = await getSubCommand(fbCmd as unknown as { subCommands: unknown }, "list");

    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => {
      lines.push(a.map(String).join(" "));
    });
    await list.run({ args: { prdId: prdRevisionId } });
    spy.mockRestore();

    const out = lines.join("\n");
    // A resolved (annotated) feedback reads `[resolved]`, an untouched one `[open]`.
    expect(out).toMatch(new RegExp(`${resolved.id}\\s+\\[resolved\\]`));
    expect(out).toMatch(new RegExp(`${open.id}\\s+\\[open\\]`));
  });

  it("`prototype feedback resolve` errors on unknown feedback id", async () => {
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const fbCmd = await getSubCommand(prototypeCommand, "feedback");
    const resolve = await getSubCommand(fbCmd as unknown as { subCommands: unknown }, "resolve");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await resolve.run({ args: { feedbackId: "NOPE" } });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("`prototype feedback ignore --reason` flips status to ignored", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const rail = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const fb = await runP(db, addFeedback({ variantId: rail.id, text: "x" }));

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const fbCmd = await getSubCommand(prototypeCommand, "feedback");
    const ignore = await getSubCommand(fbCmd as unknown as { subCommands: unknown }, "ignore");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await ignore.run({ args: { feedbackId: fb.id, reason: "out of scope" } });
    spy.mockRestore();

    const after = await db.query.prdPrototypeFeedback.findFirst({ where: { id: fb.id } });
    expect(after?.status).toBe("ignored");
    expect(after?.ignoredReason).toBe("out of scope");
    expect(after?.ignoredAt).toBeInstanceOf(Date);
  });

  it("`prototype feedback ignore` without --reason → validation error", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const rail = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const fb = await runP(db, addFeedback({ variantId: rail.id, text: "x" }));

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const fbCmd = await getSubCommand(prototypeCommand, "feedback");
    const ignore = await getSubCommand(fbCmd as unknown as { subCommands: unknown }, "ignore");

    // Validator stops the CLI before the domain even runs; emulate the
    // process.exit(1) call (the validator triggers it under the hood) by
    // catching the validation error that surfaces from the domain when the
    // exit is stubbed.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ignore.run({ args: { feedbackId: fb.id } })).rejects.toThrow(
      /reason must not be empty|--reason is required/,
    );
    exitSpy.mockRestore();
    errSpy.mockRestore();
    const after = await db.query.prdPrototypeFeedback.findFirst({ where: { id: fb.id } });
    expect(after?.status).toBe("open");
  });

  it("`prototype feedback delete` removes a feedback on the latest version", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const rail = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const fb = await runP(db, addFeedback({ variantId: rail.id, text: "delete me" }));

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const fbCmd = await getSubCommand(prototypeCommand, "feedback");
    const del = await getSubCommand(fbCmd as unknown as { subCommands: unknown }, "delete");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await del.run({ args: { feedbackId: fb.id } });
    spy.mockRestore();

    const after = await db.query.prdPrototypeFeedback.findFirst({ where: { id: fb.id } });
    expect(after).toBeUndefined();
  });

  it("`prototype feedback delete` refuses to delete a stale-version feedback", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const rail = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail v1",
        htmlContent: "<p/>",
      }),
    );
    const fb = await runP(db, addFeedback({ variantId: rail.id, text: "leave me" }));

    const v2 = await runP(db, addVersion({ pageId: page.id, label: "v2" }));
    await runP(
      db,
      addVariant({
        pageVersionId: v2.id,
        label: "rail",
        title: "Rail v2",
        htmlContent: "<p/>",
      }),
    );

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const fbCmd = await getSubCommand(prototypeCommand, "feedback");
    const del = await getSubCommand(fbCmd as unknown as { subCommands: unknown }, "delete");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await del.run({ args: { feedbackId: fb.id } });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();

    const after = await db.query.prdPrototypeFeedback.findFirst({ where: { id: fb.id } });
    expect(after).toBeDefined();
  });

  it("`feedback list --variant=<id>` narrows to a single variant", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const rail = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const tabs = await runP(
      db,
      addVariant({
        pageVersionId: v1.id,
        label: "tabs",
        title: "Tabs",
        htmlContent: "<p/>",
      }),
    );
    await runP(db, addFeedback({ variantId: rail.id, text: "r" }));
    await runP(db, addFeedback({ variantId: tabs.id, text: "t" }));
    const itemsAll = await runP(db, listFeedbacks(prdRevisionId));
    expect(itemsAll).toHaveLength(2);
    const itemsTabs = await runP(db, listFeedbacks(prdRevisionId, { variantId: tabs.id }));
    expect(itemsTabs.map((f) => f.text)).toEqual(["t"]);
  });

  it("`prototype variant elect` / `unelect` records and clears the round election", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const tabs = await runP(
      db,
      addVariant({ pageVersionId: v1.id, label: "tabs", title: "Tabs", htmlContent: "<p/>" }),
    );

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const variantCmd = await getSubCommand(prototypeCommand, "variant");
    const elect = await getSubCommand(variantCmd as unknown as { subCommands: unknown }, "elect");
    const unelect = await getSubCommand(
      variantCmd as unknown as { subCommands: unknown },
      "unelect",
    );

    const electedEntry = async () => {
      const current = (await runP(db, getCurrentRound(proto.id)))!;
      return (await runP(db, listRoundPages(current.id))).find((e) => e.pageId === page.id)!;
    };

    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await elect.run({
      args: { variantId: tabs.id, rationale: "clearest layout", by: "direction", round: undefined },
    });
    out.mockRestore();

    let entry = await electedEntry();
    expect(entry.chosenVariantId).toBe(tabs.id);
    expect(entry.decisionRationale).toBe("clearest layout");
    expect(entry.decidedBy).toBe("direction");

    const out2 = vi.spyOn(console, "log").mockImplementation(() => {});
    await unelect.run({ args: { variantId: tabs.id, round: undefined } });
    out2.mockRestore();

    entry = await electedEntry();
    expect(entry.chosenVariantId).toBeNull();
    expect(entry.decisionRationale).toBeNull();
  });

  it("`prototype distill <pageId>` records the page's placement on the current round", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    await runP(
      db,
      addVariant({ pageVersionId: v1.id, label: "only", title: "Only", htmlContent: "<p/>" }),
    );

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const distill = await getSubCommand(prototypeCommand, "distill");
    const SPEC = "## Regions\nHeader top, list below.\n\n## Order\nHeader then list.";
    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await distill.run({ args: { pageId: page.id, round: undefined, spec: SPEC } });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      payload: { item: { placementSpec: string; roundId: string; pageId: string } };
    };
    expect(env.payload.item.placementSpec).toBe(SPEC);
    expect(env.payload.item.pageId).toBe(page.id);

    const current = (await runP(db, getCurrentRound(proto.id)))!;
    expect(env.payload.item.roundId).toBe(current.id);

    const events = await db.query.activityLog.findMany({});
    expect(events.some((e) => e.eventType === "prototype_page_placement_distilled")).toBe(true);
  });

  it("`prototype distill` rejects a spec missing the key sections", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    await runP(
      db,
      addVariant({ pageVersionId: v1.id, label: "only", title: "Only", htmlContent: "<p/>" }),
    );

    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const distill = await getSubCommand(prototypeCommand, "distill");
    // The domain section guard surfaces as a ValidationError; the command does
    // not store anything when it fires.
    await expect(
      distill.run({ args: { pageId: page.id, round: undefined, spec: "just prose, no sections" } }),
    ).rejects.toThrow(/Regions.*Order/);
    const current = (await runP(db, getCurrentRound(proto.id)))!;
    const stored = await runP(db, getRoundPagePlacement(current.id, page.id));
    expect(stored).toBeNull();
  });

  it("`prd ready` design-lock gate blocks an unconverged prototype PRD; --skip-design-lock bypasses", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    await runP(
      db,
      addVariant({ pageVersionId: v1.id, label: "tabs", title: "Tabs", htmlContent: "<p/>" }),
    );

    const { prdCommand } = await import("#/cli/commands/prds");
    const ready = await getSubCommand(prdCommand, "ready");

    const prev = process.env["DEPOT_BYPASS_USER_CONFIRMATION"];
    delete process.env["DEPOT_BYPASS_USER_CONFIRMATION"];
    try {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit:1");
      }) as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        ready.run({ args: { prdId: prdRevisionId, userConfirmed: "go" } }),
      ).rejects.toThrow("process.exit:1");
      exitSpy.mockRestore();
      errSpy.mockRestore();
      expect(
        (await db.query.prdRevisions.findFirst({ where: { id: prdRevisionId } }))?.status,
      ).toBe("draft");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await ready.run({
        args: { prdId: prdRevisionId, userConfirmed: "go", skipDesignLock: true },
      });
      out.mockRestore();
      expect(
        (await db.query.prdRevisions.findFirst({ where: { id: prdRevisionId } }))?.status,
      ).toBe("ready");
    } finally {
      if (prev !== undefined) process.env["DEPOT_BYPASS_USER_CONFIRMATION"] = prev;
    }
  });

  // ── Rounds (PRD 0029 / Tranche D) ──────────────────────────────────────────

  async function getRoundSub(name: string) {
    const { prototypeCommand } = await import("#/cli/commands/prd-prototype");
    const roundCmd = await getSubCommand(prototypeCommand, "round");
    return getSubCommand(roundCmd as unknown as { subCommands: unknown }, name);
  }

  it("`prototype round add` opens a round and reports its id + label", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const add = await getRoundSub("add");

    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await add.run({ args: { prototypeId: proto.id, label: "v2" } });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      kind: string;
      payload: { item: { id: string; label: string } };
    };
    expect(env.kind).toBe("success");
    expect(env.payload.item.label).toBe("v2");
    const rounds = await runP(db, listRounds(proto.id));
    expect(rounds.map((r) => r.label)).toEqual(["v1", "v2"]);

    const events = await db.query.activityLog.findMany({});
    expect(events.some((e) => e.eventType === "prototype_round_created")).toBe(true);
  });

  it("`prototype round add --from <label>` clones the source manifest", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    // addVersion auto-included the page into the current round (label "v1").
    const source = (await runP(db, getCurrentRound(proto.id)))!;
    expect(source.label).toBe("v1");

    const add = await getRoundSub("add");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await add.run({ args: { prototypeId: proto.id, label: "v2", from: "v1" } });
    spy.mockRestore();

    const rounds = await runP(db, listRounds(proto.id));
    const cloned = rounds.find((r) => r.label === "v2")!;
    const manifest = await runP(db, listRoundPages(cloned.id));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.pageId).toBe(page.id);
    expect(manifest[0]!.pageVersionId).toBe(v1.id);
  });

  it("`prototype round add --from-current` clones the CURRENT round without naming --from", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    // addVersion auto-included the page into the current round (label "v1").
    const source = (await runP(db, getCurrentRound(proto.id)))!;
    expect(source.label).toBe("v1");

    const add = await getRoundSub("add");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Feedback ⇒ new round: open the next round from the current one without
    // having to look up its label.
    await add.run({ args: { prototypeId: proto.id, label: "v2", fromCurrent: true } });
    spy.mockRestore();

    const rounds = await runP(db, listRounds(proto.id));
    const cloned = rounds.find((r) => r.label === "v2")!;
    const manifest = await runP(db, listRoundPages(cloned.id));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.pageId).toBe(page.id);
    expect(manifest[0]!.pageVersionId).toBe(v1.id);
  });

  it("`prototype round add` rejects --from together with --from-current", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const add = await getRoundSub("add");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await add.run({
      args: { prototypeId: proto.id, label: "v2", from: "v1", fromCurrent: true },
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("`prototype round add` errors on an unknown source round", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const add = await getRoundSub("add");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await add.run({ args: { prototypeId: proto.id, label: "v2", from: "ghost" } });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("`prototype round list` --json marks the current round and counts pages", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    await runP(db, createRound({ prototypeId: proto.id, label: "v2" }));

    const list = await getRoundSub("list");
    const stdout = await captureStdout(async () => {
      setJsonMode(true);
      try {
        await list.run({ args: { prototypeId: proto.id } });
      } finally {
        setJsonMode(false);
      }
    });
    const env = JSON.parse(stdout.trim()) as {
      payload: {
        items: Array<{ label: string; pages: number; isCurrent: boolean }>;
      };
    };
    const items = env.payload.items;
    expect(items.map((i) => i.label)).toEqual(["v1", "v2"]);
    // v1 shipped the auto-included page; v2 is current with an empty manifest.
    const v1 = items.find((i) => i.label === "v1")!;
    const v2 = items.find((i) => i.label === "v2")!;
    expect(v1.pages).toBe(1);
    expect(v1.isCurrent).toBe(false);
    expect(v2.isCurrent).toBe(true);
  });

  it("`prototype round pin` updates the manifest pin and logs an event", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const v2 = await runP(db, addVersion({ pageId: page.id, label: "v2" }));
    const round = (await runP(db, getCurrentRound(proto.id)))!;

    const pin = await getRoundSub("pin");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await pin.run({ args: { roundId: round.id, pageId: page.id, version: v1.id } });
    spy.mockRestore();

    const manifest = await runP(db, listRoundPages(round.id));
    expect(manifest[0]!.pageVersionId).toBe(v1.id);
    expect(v2).toBeDefined();

    const events = await db.query.activityLog.findMany({});
    expect(events.some((e) => e.eventType === "prototype_round_page_pinned")).toBe(true);
  });

  it("`prototype round include` pins the latest active version when --version is omitted", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const v2 = await runP(db, addVersion({ pageId: page.id, label: "v2" }));
    // Open a fresh empty current round so include is meaningful.
    const round = await runP(db, createRound({ prototypeId: proto.id, label: "rel-2" }));
    expect(await runP(db, listRoundPages(round.id))).toHaveLength(0);

    const include = await getRoundSub("include");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await include.run({ args: { roundId: round.id, pageId: page.id } });
    spy.mockRestore();

    const manifest = await runP(db, listRoundPages(round.id));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.pageVersionId).toBe(v2.id);
  });

  it("`prototype round drop` removes a page from the manifest and logs an event", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const round = (await runP(db, getCurrentRound(proto.id)))!;
    expect(await runP(db, listRoundPages(round.id))).toHaveLength(1);

    const drop = await getRoundSub("drop");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await drop.run({ args: { roundId: round.id, pageId: page.id } });
    spy.mockRestore();

    expect(await runP(db, listRoundPages(round.id))).toHaveLength(0);
    const events = await db.query.activityLog.findMany({});
    expect(events.some((e) => e.eventType === "prototype_round_page_dropped")).toBe(true);
  });

  it("`prototype round pin` errors on an unknown round", async () => {
    const proto = await runP(db, createPrototype({ prdRevisionId, slug: "p" }));
    const page = await runP(db, addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await runP(db, addVersion({ pageId: page.id, label: "v1" }));
    const pin = await getRoundSub("pin");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await pin.run({ args: { roundId: "NOPE", pageId: page.id, version: v1.id } });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
