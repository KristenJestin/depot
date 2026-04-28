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
          candidate === getInstallDirectory("claude-code", homeDir),
      },
    );

    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.target)).toEqual(["opencode", "claude-code"]);
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

  it("builds command files that instruct the agent to run depot context via bash", () => {
    const content = buildCommandFileContent("opencode", "dev");

    expect(content).toContain("description: Inject the live depot dev context");
    expect(content).toContain("Run `depot context dev`");
    expect(content).not.toContain("--ws");
  });

  it("builds the same content regardless of target", () => {
    const opencodeContent = buildCommandFileContent("opencode", "prd");
    const claudeContent = buildCommandFileContent("claude-code", "prd");

    expect(opencodeContent).toBe(claudeContent);
  });

  it("does not contain any shell execution syntax", () => {
    const content = buildCommandFileContent("opencode", "prd");

    expect(content).not.toContain("!`");
    expect(content).not.toContain("disable-model-invocation");
    expect(content).not.toContain("shell:");
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

    expect(writes).toHaveLength(2);
    expect(writes.map((write) => write.filePath.replace(/\\/g, "/"))).toEqual([
      "/home/tester/.config/opencode/commands/depot-prd.md",
      "/home/tester/.config/opencode/commands/depot-dev.md",
    ]);
    for (const write of writes) {
      expect(write.content).toContain("Run `depot context");
      expect(write.content).not.toContain("--ws");
    }
  });
});
