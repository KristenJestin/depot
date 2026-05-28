/**
 * Transcript-style logger for E2E scenarios.
 *
 * Mirrors the `● Bash(…)` style of Claude Code: each agent command, sleep,
 * and assertion failure produces a single visually distinct line, indented
 * to suggest they live inside a scenario block. The goal is that a developer
 * (or another agent) reading the output can mentally replay the exact
 * sequence of shell calls without opening a debugger.
 */

const PREFIX = "  ";

type Stream = "stdout" | "stderr";

function write(stream: Stream, line: string): void {
  const target = stream === "stdout" ? process.stdout : process.stderr;
  target.write(`${PREFIX}${line}\n`);
}

export function logScenarioStart(name: string): void {
  process.stdout.write(`\n[e2e] ${name}\n`);
}

export function logBash(cmd: string, cwd: string): void {
  write("stdout", `● bash: ${cmd} (cwd: ${cwd})`);
}

export function logBashResult(durationMs: number, exitCode: number | null): void {
  const code = exitCode ?? "?";
  write("stdout", `◷ ${durationMs}ms, exit ${code}`);
}

export function logSleep(ms: number): void {
  write("stdout", `◷ sleep ${ms}ms`);
}

export function logExpectFailure(kind: string, lines: ReadonlyArray<string>): void {
  write("stderr", `✗ expect.${kind} failed`);
  for (const line of lines) {
    write("stderr", `   ${line}`);
  }
}

export function truncate(value: string, max = 500): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}… (${value.length - max} more chars)`;
}
