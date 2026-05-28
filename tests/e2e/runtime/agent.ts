import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logBash, logBashResult, logSleep } from "./log";

/**
 * Faux-agent shell. Executes the built CLI (`dist/index.mjs`) with an isolated
 * `DEPOT_DB_PATH` per scenario so concurrent and back-to-back scenarios never
 * collide. The agent does not reason — it strictly plays the sequence of
 * commands a scenario hands it, and exposes the same shape Claude Code's
 * bash tool returns (`stdout`, `stderr`, `exitCode`, `durationMs`).
 *
 * `agent.spawn(cmd, opts)` (PRD 0016 / T2) is the background variant of
 * `run`: it starts a long-lived process (e.g. `depot serve`) and returns a
 * handle exposing `kill(signal?)` and `waitForPort(port, timeoutMs)`. The
 * helper registers an auto-cleanup hook via the scenario's `registerCleanup`
 * channel so a still-running child is killed when the scenario unwinds,
 * even if the body throws. `waitForPort` repeatedly attempts a TCP connect
 * (no payload sent) until the port accepts or the timeout elapses.
 */

export type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
};

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  expectExit?: number | "any";
  timeoutMs?: number;
  input?: string;
};

export type SpawnOpts = {
  cwd?: string;
  env?: Record<string, string>;
};

export type SpawnHandle = {
  readonly pid: number;
  kill(signal?: NodeJS.Signals): void;
  waitForPort(port: number, timeoutMs?: number): Promise<void>;
};

export type AgentHelper = {
  readonly depotBin: string;
  readonly envFile: string;
  run(cmd: string, opts?: RunOptions): Promise<RunResult>;
  runJson<T = unknown>(cmd: string, opts?: RunOptions): Promise<T>;
  spawn(cmd: string, opts?: SpawnOpts): SpawnHandle;
  cd(target: string): void;
  sleep(ms: number): Promise<void>;
};

export type AgentSetup = {
  scenarioRoot: string;
  initialCwd: string;
  registerCleanup?: (fn: () => Promise<void> | void) => void;
};

const REPO_ROOT = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..");
})();

const DEPOT_BIN = path.join(REPO_ROOT, "dist", "index.mjs");

export function getDepotBin(): string {
  return DEPOT_BIN;
}

export function getRepoRoot(): string {
  return REPO_ROOT;
}

/**
 * Splits a command string into argv, supporting single- and double-quoted
 * arguments (with escape `\"` / `\'` inside the matching quote). Enough for
 * the deterministic commands scenarios produce; not a full shell parser,
 * intentionally. Backslashes outside quotes are preserved so Windows paths
 * like `C:\tmp\repo` survive intact.
 */
function splitCommand(cmd: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (quote) {
      if (ch === "\\" && i + 1 < cmd.length) {
        const next = cmd[i + 1]!;
        if (next === quote || next === "\\") {
          buf += next;
          i++;
          continue;
        }
      }
      if (ch === quote) {
        quote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (buf.length > 0) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) {
    out.push(buf);
  }
  return out;
}

export async function createAgentHelper(setup: AgentSetup): Promise<AgentHelper> {
  const envFile = path.join(setup.scenarioRoot, ".env");
  const dbPath = path.join(setup.scenarioRoot, "depot.db");

  await writeFile(
    envFile,
    [`DEPOT_DB_PATH=${dbPath}`, `DEPOT_QUIET=1`, `DEPOT_BYPASS_USER_CONFIRMATION=1`, ""].join("\n"),
    "utf-8",
  );

  let currentCwd = setup.initialCwd;

  async function run(cmd: string, opts: RunOptions = {}): Promise<RunResult> {
    const argv = splitCommand(cmd);
    if (argv.length === 0) {
      throw new Error("agent.run: empty command");
    }

    const isDepotCommand = argv[0] === "depot";
    const depotArgs = argv.slice(1);

    const cwd = opts.cwd ?? currentCwd;
    logBash(cmd, cwd);

    const command = isDepotCommand ? "node" : argv[0];
    const childArgs = isDepotCommand
      ? [`--env-file-if-exists=${envFile}`, DEPOT_BIN, ...depotArgs]
      : argv.slice(1);
    const env = {
      ...process.env,
      DEPOT_DB_PATH: dbPath,
      DEPOT_QUIET: "1",
      DEPOT_BYPASS_USER_CONFIRMATION: "1",
      ...opts.env,
    };

    const started = Date.now();
    const result = await spawnAndWait(command, childArgs, {
      cwd,
      env,
      timeoutMs: opts.timeoutMs ?? 30_000,
      input: opts.input,
    });
    const durationMs = Date.now() - started;

    logBashResult(durationMs, result.exitCode);

    const expectExit = opts.expectExit ?? 0;
    if (expectExit !== "any" && result.exitCode !== expectExit) {
      throw new Error(
        `agent.run: expected exit ${expectExit}, got ${result.exitCode}\n` +
          `  cmd: ${cmd}\n` +
          `  cwd: ${cwd}\n` +
          `  stdout: ${result.stdout}\n` +
          `  stderr: ${result.stderr}`,
      );
    }

    return { ...result, durationMs };
  }

  async function runJson<T>(cmd: string, opts: RunOptions = {}): Promise<T> {
    const result = await run(cmd, opts);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (e) {
      throw new Error(
        `agent.runJson: stdout is not valid JSON\n  cmd: ${cmd}\n  stdout: ${result.stdout}\n  error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "kind" in parsed &&
      (parsed as { kind: unknown }).kind === "success" &&
      "payload" in parsed
    ) {
      return (parsed as { payload: T }).payload;
    }
    return parsed as T;
  }

  function cd(target: string): void {
    currentCwd = target;
  }

  async function sleep(ms: number): Promise<void> {
    logSleep(ms);
    await new Promise<void>((r) => setTimeout(r, ms));
  }

  function spawnBg(cmd: string, opts: SpawnOpts = {}): SpawnHandle {
    const argv = splitCommand(cmd);
    if (argv.length === 0) {
      throw new Error("agent.spawn: empty command");
    }

    const isDepotCommand = argv[0] === "depot";
    const depotArgs = argv.slice(1);

    const cwd = opts.cwd ?? currentCwd;
    logBash(`(bg) ${cmd}`, cwd);

    const command = isDepotCommand ? "node" : argv[0];
    const childArgs = isDepotCommand
      ? [`--env-file-if-exists=${envFile}`, DEPOT_BIN, ...depotArgs]
      : argv.slice(1);
    const env = {
      ...process.env,
      DEPOT_DB_PATH: dbPath,
      DEPOT_QUIET: "1",
      DEPOT_BYPASS_USER_CONFIRMATION: "1",
      ...opts.env,
    };

    const child = spawn(command, childArgs as string[], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    if (!child.pid) {
      throw new Error(`agent.spawn: failed to start '${command}'`);
    }

    // Drain stdio so the OS pipe buffers never fill up (and never block the
    // child). We do not assert on the output here — the scenario probes the
    // process externally (HTTP, port, log file, etc.).
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", () => {});

    let killed = false;
    const killChild = (signal: NodeJS.Signals = "SIGTERM"): void => {
      if (killed) return;
      killed = true;
      try {
        child.kill(signal);
      } catch {
        // process may already be gone; ignore.
      }
    };

    if (setup.registerCleanup) {
      setup.registerCleanup(async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        killChild("SIGTERM");
        // Give the process a short grace period to release its port and
        // file descriptors before the tmp dir is removed under it. SIGKILL
        // it if it is still alive.
        await new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          child.once("exit", done);
          setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              try {
                child.kill("SIGKILL");
              } catch {
                // ignore
              }
            }
            done();
          }, 500);
        });
      });
    }

    const waitForPort = async (port: number, timeoutMs = 5_000): Promise<void> => {
      const deadline = Date.now() + timeoutMs;
      const stepMs = 50;
      let lastError: unknown = null;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) {
          throw new Error(
            `agent.spawn.waitForPort: child exited with code ${child.exitCode} before port ${port} opened`,
          );
        }
        const ok = await new Promise<boolean>((resolve) => {
          const sock = createConnection({ host: "127.0.0.1", port });
          sock.once("connect", () => {
            sock.end();
            resolve(true);
          });
          sock.once("error", (err) => {
            lastError = err;
            sock.destroy();
            resolve(false);
          });
        });
        if (ok) return;
        await new Promise<void>((r) => setTimeout(r, stepMs));
      }
      throw new Error(
        `agent.spawn.waitForPort: port ${port} did not open within ${timeoutMs}ms` +
          (lastError ? ` (last error: ${(lastError as Error).message ?? String(lastError)})` : ""),
      );
    };

    return {
      pid: child.pid,
      kill: killChild,
      waitForPort,
    };
  }

  return { depotBin: DEPOT_BIN, envFile, run, runJson, spawn: spawnBg, cd, sleep };
}

type SpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  input?: string;
};

function spawnAndWait(
  command: string,
  args: ReadonlyArray<string>,
  opts: SpawnOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args as string[], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`agent.run: timed out after ${opts.timeoutMs}ms (${command})`));
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code,
      });
    });

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}
