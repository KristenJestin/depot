import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCommandFileContent,
  buildInstallWrites,
  detectCommandShell,
  getInstallDirectory,
  resolveInstallTargets,
} from "#/modules/install/agent";

describe("agent install helpers", () => {
  it("detects both command directories when they already exist", async () => {
    const homeDir = "/home/tester";
    const targets = await resolveInstallTargets(
      {},
      {
        homeDir,
        existsSync: (candidate) =>
          candidate === getInstallDirectory("opencode", homeDir) ||
          candidate === getInstallDirectory("claude-code", homeDir) ||
          candidate === getInstallDirectory("codex", homeDir),
      },
    );

    expect(targets).toHaveLength(3);
    expect(targets.map((target) => target.target)).toEqual(["opencode", "claude-code", "codex"]);
    expect(targets.every((target) => target.ensureDirectory === false)).toBe(true);
  });

  it("creates the requested canonical directory when an explicit flag is used", async () => {
    const homeDir = "/home/tester";
    const targets = await resolveInstallTargets(
      { opencode: true },
      {
        homeDir,
        existsSync: () => false,
      },
    );

    expect(targets).toEqual([
      {
        target: "opencode",
        directory: path.join(homeDir, ".config", "opencode", "commands"),
        ensureDirectory: true,
      },
    ]);
  });

  it("builds command files that inject depot context directly", () => {
    const content = buildCommandFileContent("opencode", "dev");

    expect(content).toContain("description: Inject the live depot dev context");
    expect(content).toContain("Use the injected depot dev context below");
    expect(content).toContain("!`depot context dev $ARGUMENTS`");
    expect(content).toContain("forwarded to `depot context dev <prd-id>`");
    expect(content).not.toContain("--ws");
  });

  it("builds the same injected body regardless of target", () => {
    const opencodeContent = buildCommandFileContent("opencode", "prd");
    const claudeContent = buildCommandFileContent("claude-code", "prd");

    expect(opencodeContent).toContain("!`depot context prd`");
    expect(claudeContent).toContain("!`depot context prd`");
    expect(opencodeContent).toContain("Use the injected depot PRD context below");
    expect(claudeContent).toContain("Use the injected depot PRD context below");
  });

  it("uses native context injection syntax", () => {
    const content = buildCommandFileContent("opencode", "prd");

    expect(content).toContain("!`depot context prd`");
    expect(content).not.toContain("disable-model-invocation");
  });

  it("adds claude-specific frontmatter", () => {
    const content = buildCommandFileContent("claude-code", "prd");

    expect(content).toContain("disable-model-invocation: true");
    expect(content).not.toContain("shell:");
  });

  it("builds codex skills that tell Codex to load live context", () => {
    const content = buildCommandFileContent("codex", "dev");

    expect(content).toContain("name: depot-dev");
    expect(content).toContain("description: Load the live depot dev context");
    expect(content).toContain("Run `depot context dev` immediately");
    expect(content).toContain("If the user invoked `$depot-dev <prd-id>`");
    expect(content).toContain("run `depot context dev <prd-id>` instead");
    expect(content).toContain("Do not rerun `depot context dev`");
  });

  it("detects the shell from the platform", () => {
    expect(detectCommandShell("win32")).toBe("powershell");
    expect(detectCommandShell("linux")).toBe("bash");
    expect(detectCommandShell("darwin")).toBe("bash");
  });

  it("creates two writes per selected target", () => {
    const writes = buildInstallWrites([
      {
        target: "opencode",
        directory: "/home/tester/.config/opencode/commands",
        ensureDirectory: true,
      },
    ]);

    expect(writes).toHaveLength(4);
    expect(writes.map((write) => write.filePath.replace(/\\/g, "/"))).toEqual([
      "/home/tester/.config/opencode/commands/depot-prd.md",
      "/home/tester/.config/opencode/commands/depot-dev.md",
      "/home/tester/.config/opencode/commands/depot-doc.md",
      "/home/tester/.config/opencode/commands/depot-ship.md",
    ]);
    expect(writes.find((write) => write.mode === "dev")?.content).toContain(
      "!`depot context dev $ARGUMENTS`",
    );
    for (const write of writes) {
      expect(write.content).toContain("!`depot context");
      expect(write.content).not.toContain("--ws");
    }
  });

  it("writes codex modes as skills", () => {
    const writes = buildInstallWrites([
      {
        target: "codex",
        directory: "/home/tester/.agents/skills",
        ensureDirectory: true,
      },
    ]);

    expect(writes).toHaveLength(8);
    expect(writes.map((write) => write.kind)).toEqual([
      "skill",
      "skill",
      "skill",
      "skill",
      "skill",
      "skill",
      "skill",
      "skill",
    ]);
    expect(writes.map((write) => write.filePath.replace(/\\/g, "/"))).toEqual([
      "/home/tester/.agents/skills/depot-prd/SKILL.md",
      "/home/tester/.agents/skills/depot-prd/agents/openai.yaml",
      "/home/tester/.agents/skills/depot-dev/SKILL.md",
      "/home/tester/.agents/skills/depot-dev/agents/openai.yaml",
      "/home/tester/.agents/skills/depot-doc/SKILL.md",
      "/home/tester/.agents/skills/depot-doc/agents/openai.yaml",
      "/home/tester/.agents/skills/depot-ship/SKILL.md",
      "/home/tester/.agents/skills/depot-ship/agents/openai.yaml",
    ]);
    expect(writes.map((write) => write.directory.replace(/\\/g, "/"))).toEqual([
      "/home/tester/.agents/skills/depot-prd",
      "/home/tester/.agents/skills/depot-prd/agents",
      "/home/tester/.agents/skills/depot-dev",
      "/home/tester/.agents/skills/depot-dev/agents",
      "/home/tester/.agents/skills/depot-doc",
      "/home/tester/.agents/skills/depot-doc/agents",
      "/home/tester/.agents/skills/depot-ship",
      "/home/tester/.agents/skills/depot-ship/agents",
    ]);
    expect(writes.map((write) => write.content)).toContain(
      [
        "interface:",
        '  display_name: "Depot PRD"',
        '  short_description: "Load live depot prd context on demand"',
        "policy:",
        "  allow_implicit_invocation: false",
      ].join("\n"),
    );
  });
});
