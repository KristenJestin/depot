import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCommandFileContent,
  buildInstallWrites,
  detectCommandShell,
  getInstallDirectory,
  resolveInstallTargets,
} from "#/lib/agent-install";

describe("agent install helpers", () => {
  it("detects both command directories when they already exist", () => {
    const homeDir = "/home/tester";
    const targets = resolveInstallTargets(
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

  it("creates the requested canonical directory when an explicit flag is used", () => {
    const homeDir = "/home/tester";
    const targets = resolveInstallTargets(
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

  it("builds OpenCode command files with live depot context injection", () => {
    const content = buildCommandFileContent("opencode", "dev");

    expect(content).toContain("description: Inject the live depot dev context");
    expect(content).toContain("!`depot context dev`");
    expect(content).not.toContain("shell:");
  });

  it("builds Claude Code command files with host shell injection", () => {
    const content = buildCommandFileContent("claude-code", "review");

    expect(content).toContain("description: Inject the live depot review context");
    expect(content).toContain("disable-model-invocation: true");
    expect(content).toContain(`shell: ${detectCommandShell()}`);
    expect(content).toContain("!`depot context review`");
  });

  it("detects the shell from the platform", () => {
    expect(detectCommandShell("win32")).toBe("powershell");
    expect(detectCommandShell("linux")).toBe("bash");
    expect(detectCommandShell("darwin")).toBe("bash");
  });

  it("creates three writes per selected target", () => {
    const writes = buildInstallWrites([
      {
        target: "opencode",
        directory: "/home/tester/.config/opencode/commands",
        ensureDirectory: true,
      },
    ]);

    expect(writes).toHaveLength(3);
    expect(writes.map((write) => write.filePath.replace(/\\/g, "/"))).toEqual([
      "/home/tester/.config/opencode/commands/depot-prd.md",
      "/home/tester/.config/opencode/commands/depot-dev.md",
      "/home/tester/.config/opencode/commands/depot-review.md",
    ]);
  });
});
