import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { logDbBoot } from "#/cli/log-db-boot";

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(keys: string[]): EnvSnapshot {
  return Object.fromEntries(keys.map((k) => [k, process.env[k]]));
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

describe("logDbBoot", () => {
  const envKeys = ["DEPOT_DB_PATH", "DB_PATH", "DEPOT_QUIET"];
  let envSnapshot: EnvSnapshot;
  let argvSnapshot: string[];
  let isTTYSnapshot: boolean | undefined;
  let writes: string[];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    envSnapshot = snapshotEnv(envKeys);
    argvSnapshot = process.argv;
    isTTYSnapshot = process.stderr.isTTY;
    for (const k of envKeys) delete process.env[k];
    process.argv = ["node", "depot"];
    writes = [];
    writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      });
  });

  afterEach(() => {
    writeSpy.mockRestore();
    process.argv = argvSnapshot;
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: isTTYSnapshot,
    });
    restoreEnv(envSnapshot);
  });

  it("prints a yellow-coloured prod warning when stderr is a TTY", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
    logDbBoot();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("[depot] DB: prod (");
    expect(writes[0]).toContain("\u001b[33m");
    expect(writes[0]).toContain("\u001b[0m");
  });

  it("prefixes the prod line with WARNING: when stderr is not a TTY", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
    logDbBoot();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^WARNING: \[depot\] DB: prod \(/);
    expect(writes[0]).not.toContain("\u001b[");
  });

  it("emits a plain dev line without colour", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
    process.env["DEPOT_DB_PATH"] = ".depot-dev/depot.db";
    logDbBoot();
    expect(writes).toEqual(["[depot] DB: dev (.depot-dev/depot.db)\n"]);
  });

  it("emits a plain custom line without colour", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
    process.env["DEPOT_DB_PATH"] = "/tmp/whatever.db";
    logDbBoot();
    expect(writes).toEqual(["[depot] DB: custom (/tmp/whatever.db)\n"]);
  });

  it("is silent when DEPOT_QUIET=1", () => {
    process.env["DEPOT_QUIET"] = "1";
    process.env["DEPOT_DB_PATH"] = ".depot-dev/depot.db";
    logDbBoot();
    expect(writes).toEqual([]);
  });

  it("is silent when --json is present in argv", () => {
    process.env["DEPOT_DB_PATH"] = ".depot-dev/depot.db";
    process.argv = ["node", "depot", "--json", "task", "ls"];
    logDbBoot();
    expect(writes).toEqual([]);
  });

  it("is silent when --json=true is present in argv", () => {
    process.env["DEPOT_DB_PATH"] = ".depot-dev/depot.db";
    process.argv = ["node", "depot", "--json=true"];
    logDbBoot();
    expect(writes).toEqual([]);
  });

  it("emits a deprecation warning when only the legacy DB_PATH is set", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
    process.env["DB_PATH"] = ".depot-dev/depot.db";
    logDbBoot();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toBe("[depot] DB: dev (.depot-dev/depot.db)\n");
    expect(writes[1]).toBe("[depot] WARN: DB_PATH is deprecated, use DEPOT_DB_PATH instead.\n");
  });

  it("does not emit a deprecation warning when DEPOT_DB_PATH is set", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
    process.env["DEPOT_DB_PATH"] = ".depot-dev/depot.db";
    process.env["DB_PATH"] = ".depot-dev/depot.db";
    logDbBoot();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe("[depot] DB: dev (.depot-dev/depot.db)\n");
  });
});
