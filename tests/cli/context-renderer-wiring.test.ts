/**
 * PRD 0013 / T3 — `depot context X` is wired through the template renderer.
 *
 * Each mode now passes its static template body through `renderTemplate`, so
 * `{{directives …}}` and `{{hooks …}}` markers are substituted with the
 * project's current directives before being emitted.
 *
 * Coverage:
 *
 *   (1) Empty project: every mode renders its template with all markers
 *       collapsed to the empty placeholders (no `{{ … }}` left behind).
 *   (2) Project with 2-3 directives across `(category, scope)` combinations:
 *       `dev` mode shows the rendered ground rules + a hook block inline.
 *   (3) Renderer failure (workspace cannot be resolved): the command still
 *       exits successfully, stdout carries the RAW template (markers
 *       included), stderr carries the one-line warning.
 *
 * The runtime module is mocked so the in-memory test DB is used through both
 * `resolveCurrentWorkspace` and `runEffect`, mirroring the pattern used in
 * `tests/cli/commands.test.ts` and `tests/cli/prd-hooks-checks.test.ts`.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { Db } from "#/services/database";
import { addWorkspace, createProject } from "#/lib/workflow";
import { createDirective } from "#/modules/projects/directives";
import { createIdea, linkIdeaToPrd } from "#/modules/ideas/domain";
import { createPrd } from "#/modules/prds/domain";
import { setJsonMode } from "#/shared/logger";

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

type ContextMode = "prd" | "dev" | "coder" | "auditor" | "doc" | "ship" | "idea";

interface RunContextArgs {
  mode: ContextMode;
  prdTarget?: string;
  axis?: "standards" | "spec";
  review?: string;
}

async function runContextCommand(args: RunContextArgs): Promise<string> {
  const { contextCommand } = await import("#/cli/commands/context");
  const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await contextCommand.run?.({
      rawArgs: [],
      args: { prdTarget: "", ...args } as any,
      cmd: contextCommand,
    } as any);
    return stdout.mock.calls.map((call) => String(call[0])).join("\n");
  } finally {
    stdout.mockRestore();
  }
}

async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const messages: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return messages.join("\n");
}

describe("depot context X — template renderer wiring (PRD 0013 / T3)", () => {
  let db: Database;
  let projectId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;
    const project = await createProject(db, { name: "ctx-wiring" });
    projectId = project.id;
    const workspace = await addWorkspace(db, {
      projectId,
      path: "/workspace/ctx-wiring",
    });
    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    setJsonMode(false);
  });

  // ── Fixture 1: empty project ────────────────────────────────────────────────

  describe("empty project — every marker collapses to an empty placeholder", () => {
    const modes: ContextMode[] = ["prd", "dev", "coder", "auditor", "doc", "ship"];

    for (const mode of modes) {
      it(`mode '${mode}' substitutes every marker (no '{{ … }}' left)`, async () => {
        const args: RunContextArgs = { mode };
        if (mode === "auditor") args.axis = "standards";
        const out = await runContextCommand(args);

        expect(out).toContain(`=== DEPOT CONTEXT — ${mode.toUpperCase()}`);
        // Markers outside fenced code blocks must have been substituted.
        const nonFenced = stripFencedBlocks(out);
        expect(nonFenced).not.toMatch(/\{\{directives scope=/);
        expect(nonFenced).not.toMatch(/\{\{hooks scope=/);
      });
    }

    it("dev mode shows the empty-placeholder text for at least one marker", async () => {
      const out = await runContextCommand({ mode: "dev" });
      // dev.md carries both ground rules and several hook blocks; with no
      // directives the placeholders are emitted.
      expect(out).toContain("_No project directives at this stage._");
      expect(out).toContain("_No project hooks at this stage._");
    });
  });

  // ── Fixture 2: project with directives across (category, scope) pairs ──────

  describe("project with directives — rendered blocks appear inline", () => {
    beforeEach(async () => {
      const provide = <A, E>(effect: Effect.Effect<A, E, Db>): Promise<A> =>
        Effect.runPromise(Effect.provideService(effect, Db, db));
      await provide(
        createDirective({
          projectId,
          scope: "always",
          category: "dev",
          kind: "rule",
          title: "Ground rule for dev",
          instruction: "Always keep CI green before declaring a task done.",
        }),
      );
      await provide(
        createDirective({
          projectId,
          scope: "post-auditor-pass",
          category: "dev",
          kind: "rule",
          title: "Tester after auditor",
          instruction: "Spawn the tester sub-agent after the auditor passes.",
        }),
      );
      await provide(
        createDirective({
          projectId,
          scope: "pre-coder-spawn",
          category: "dev",
          kind: "command",
          title: "Pre-coder smoke",
          instruction: "bun run smoke",
          blocking: true,
        }),
      );
    });

    it("renders the dev ground rule under the ground-rules heading", async () => {
      const out = await runContextCommand({ mode: "dev" });
      expect(out).toContain("### Project ground rules (always)");
      expect(out).toContain("Ground rule for dev");
      expect(out).toContain("Always keep CI green before declaring a task done.");
    });

    it("renders the post-auditor-pass hook inline under its hook heading", async () => {
      const out = await runContextCommand({ mode: "dev" });
      expect(out).toContain("### Project hooks at this stage (post-auditor-pass)");
      expect(out).toContain("**Tester after auditor**");
      expect(out).toContain("Spawn the tester sub-agent after the auditor passes.");
    });

    it("renders the blocking pre-coder-spawn command with its Run line", async () => {
      const out = await runContextCommand({ mode: "dev" });
      expect(out).toContain("### Project hooks at this stage (pre-coder-spawn)");
      expect(out).toContain("**Pre-coder smoke** [blocking command]");
      expect(out).toContain("Run: `bun run smoke`");
    });

    it("does not leak directives from other categories into the prd template", async () => {
      const out = await runContextCommand({ mode: "prd" });
      // prd.md has `{{directives scope=always category=prd}}` only.
      expect(out).toContain("=== DEPOT CONTEXT — PRD ===");
      expect(out).toContain("_No project directives at this stage._");
      // The dev-category directive must not bleed into the prd render.
      expect(out).not.toContain("Ground rule for dev");
    });

    it("preserves the static header block on top of the rendered template", async () => {
      const out = await runContextCommand({ mode: "dev" });
      expect(out).toContain("=== DEPOT CONTEXT — DEV ===");
    });
  });

  // ── Fixture 3: fallback when the renderer fails ─────────────────────────────

  describe("renderer failure fallback", () => {
    it("emits the raw template + a stderr warning when the workspace cannot be resolved", async () => {
      const failure = new Error("no_workspace: no current workspace found");
      resolveCurrentWorkspace.mockReset();
      resolveCurrentWorkspace.mockRejectedValue(failure);

      let stdoutText = "";
      const stderrText = await captureStderr(async () => {
        stdoutText = await runContextCommand({ mode: "dev" });
      });

      // Stdout: the static header is still emitted, AND the raw template
      // body — markers included — passes through verbatim.
      expect(stdoutText).toContain("=== DEPOT CONTEXT — DEV ===");
      expect(stdoutText).toContain("{{directives scope=always category=dev}}");
      expect(stdoutText).toContain("{{hooks scope=post-auditor-pass category=dev}}");
      // The empty placeholders should NOT be present because no substitution ran.
      expect(stdoutText).not.toContain("_No project directives at this stage._");
      expect(stdoutText).not.toContain("_No project hooks at this stage._");

      // Stderr: the one-line warning announces the fallback, with the reason.
      expect(stderrText).toContain("Warning: renderer failed, emitting raw template");
      expect(stderrText).toContain("no_workspace");
    });
  });
});

// ── PRD 0027: idea capture context + recall ──────────────────────────────────

describe("depot context — idea capture + recall (PRD 0027 / T5)", () => {
  let db: Database;
  let projectId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;
    const project = await createProject(db, { name: "ideas-ctx" });
    projectId = project.id;
    const workspace = await addWorkspace(db, { projectId, path: "/workspace/ideas-ctx" });
    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    setJsonMode(false);
  });

  const provide = <A, E>(effect: Effect.Effect<A, E, Db>): Promise<A> =>
    Effect.runPromise(Effect.provideService(effect, Db, db));

  describe("context idea — capture/triage template", () => {
    it("emits the capture/librarian template (NOT the PRD grilling posture)", async () => {
      const out = await runContextCommand({ mode: "idea" });
      expect(out).toContain("=== DEPOT CONTEXT — IDEA ===");
      expect(out).toContain("# Context: Idea Sub-Agent");
      expect(out).toContain("You are NOT the PRD agent");
      expect(out).toContain("depot idea add");
      expect(out).toContain("depot idea promote");
      expect(out).toContain("## Current open ideas");
    });

    it("resolves {{idea_state}} to the open-idea list (no unresolved markers)", async () => {
      const tagged = await provide(
        createIdea({ projectId, title: "Plugin marketplace", tag: "plugins" }),
      );
      const plain = await provide(createIdea({ projectId, title: "Faster startup" }));
      const out = await runContextCommand({ mode: "idea" });
      expect(out).toContain(`${plain.id}  Faster startup`);
      expect(out).toContain(`${tagged.id}  Plugin marketplace  [plugins]`);
      // No unresolved markers anywhere outside fenced blocks.
      const nonFenced = stripFencedBlocks(out);
      expect(nonFenced).not.toMatch(/\{\{[^}]*\}\}/);
    });

    it("renders the empty placeholder when no open ideas exist", async () => {
      const out = await runContextCommand({ mode: "idea" });
      expect(out).toContain("_No open ideas._");
      const nonFenced = stripFencedBlocks(out);
      expect(nonFenced).not.toMatch(/\{\{[^}]*\}\}/);
    });
  });

  describe("context prd — recall count + source ideas", () => {
    it("shows `Ideas   : N open` and the Source ideas section with full bodies", async () => {
      const prd = await provide(createPrd({ projectId, title: "Plugin system" }));
      const idea = await provide(
        createIdea({
          projectId,
          title: "Plugin marketplace",
          body: "We should let third parties publish plugins.",
        }),
      );
      // A second open idea that is NOT linked, to prove the count counts all open.
      await provide(createIdea({ projectId, title: "Unrelated thought" }));
      await provide(linkIdeaToPrd(prd.id, idea.id));

      const out = await runContextCommand({ mode: "prd", prdTarget: prd.id });
      expect(out).toContain("Ideas   : 2 open");
      expect(out).toContain("## Source ideas");
      expect(out).toContain("Plugin marketplace");
      expect(out).toContain("We should let third parties publish plugins.");
      // Unlinked idea must NOT appear in Source ideas (only linked ideas render).
      expect(out).not.toContain("Unrelated thought");
    });

    it("omits the count row entirely when there are zero open ideas", async () => {
      const prd = await provide(createPrd({ projectId, title: "No ideas PRD" }));
      const out = await runContextCommand({ mode: "prd", prdTarget: prd.id });
      expect(out).not.toMatch(/^Ideas\s+: \d+ open$/m);
    });

    it("renders no Source ideas section when the PRD has no linked ideas", async () => {
      const prd = await provide(createPrd({ projectId, title: "Unlinked PRD" }));
      await provide(createIdea({ projectId, title: "Floating idea" }));
      const out = await runContextCommand({ mode: "prd", prdTarget: prd.id });
      // The rendered section carries this lead line; the prd.md prose mentions
      // the `## Source ideas` heading too, so assert on the lead instead.
      expect(out).not.toContain("The raw, uncommitted needs that motivated this PRD.");
      // The count row still shows because an open idea exists project-wide.
      expect(out).toContain("Ideas   : 1 open");
    });
  });

  describe("context dev/coder/auditor — ideas must NOT leak", () => {
    it("dev mode renders neither the count nor source ideas", async () => {
      const prd = await provide(createPrd({ projectId, title: "Dev PRD" }));
      const idea = await provide(
        createIdea({ projectId, title: "Leaky idea", body: "secret body" }),
      );
      await provide(linkIdeaToPrd(prd.id, idea.id));
      const out = await runContextCommand({ mode: "dev", prdTarget: prd.id });
      expect(out).not.toContain("Ideas   :");
      expect(out).not.toContain("## Source ideas");
      expect(out).not.toContain("Leaky idea");
      expect(out).not.toContain("secret body");
    });

    it("auditor mode renders neither the count nor source ideas", async () => {
      const prd = await provide(createPrd({ projectId, title: "Audit PRD" }));
      const idea = await provide(
        createIdea({ projectId, title: "Leaky idea", body: "secret body" }),
      );
      await provide(linkIdeaToPrd(prd.id, idea.id));
      const out = await runContextCommand({ mode: "auditor", prdTarget: prd.id, axis: "spec" });
      expect(out).not.toContain("Ideas   :");
      expect(out).not.toContain("## Source ideas");
      expect(out).not.toContain("Leaky idea");
      expect(out).not.toContain("secret body");
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip the contents of fenced code blocks (``` … ```) from `text`. The
 * renderer leaves markers inside fences untouched, so empty-placeholder
 * assertions must ignore them.
 */
function stripFencedBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join("\n");
}
