import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import {
  setConfig,
  getConfig,
  listConfig,
  unsetConfig,
  isKnownKey,
} from "#/modules/projects/config";
import { KNOWN_PROJECT_CONFIG_KEYS, isKnownProjectConfigKey } from "#/shared/project-config-keys";
import { createProject } from "#/modules/projects/domain";
import type { Database } from "#/db/client";

describe("project config", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
  });

  it("round-trips set / get with the source tag", async () => {
    await run(setConfig(projectId, "baseBranch", "develop", "human"));
    const row = await run(getConfig(projectId, "baseBranch"));
    expect(row?.value).toBe("develop");
    expect(row?.updatedBySource).toBe("human");
  });

  it("updates an existing key in place", async () => {
    await run(setConfig(projectId, "baseBranch", "main", "ai"));
    await run(setConfig(projectId, "baseBranch", "develop", "human"));
    const all = await run(listConfig(projectId));
    expect(all).toHaveLength(1);
    expect(all[0]?.value).toBe("develop");
    expect(all[0]?.updatedBySource).toBe("human");
  });

  it("unsetConfig removes the row", async () => {
    await run(setConfig(projectId, "baseBranch", "main", "human"));
    await run(unsetConfig(projectId, "baseBranch"));
    const row = await run(getConfig(projectId, "baseBranch"));
    expect(row).toBeUndefined();
  });

  it("isKnownKey covers the published keys", () => {
    expect(isKnownKey("baseBranch")).toBe(true);
    expect(isKnownKey("defaultDocProfile")).toBe(true);
    expect(isKnownKey("docSyncTicketPattern")).toBe(true);
    expect(isKnownKey("branchNamingConvention")).toBe(false);
    expect(isKnownKey("randomMadeUpKey")).toBe(false);
  });

  it("docSyncTicketPattern accepts a compilable regex and refuses an invalid one", () => {
    const key = KNOWN_PROJECT_CONFIG_KEYS.docSyncTicketPattern!;
    expect(key.default).toBeNull();
    expect(key.validate("TICKET-\\d+").ok).toBe(true);
    expect(key.validate("[A-Z]+-[0-9]+").ok).toBe(true);
    const bad = key.validate("TICKET-(");
    expect(bad.ok).toBe(false);
    expect(isKnownProjectConfigKey("docSyncTicketPattern")).toBe(true);
  });

  it("KNOWN_PROJECT_CONFIG_KEYS validators reject bad values", () => {
    const bb = KNOWN_PROJECT_CONFIG_KEYS.baseBranch!;
    expect(bb.validate("feat/foo").ok).toBe(true);
    expect(bb.validate("invalid branch name!").ok).toBe(false);

    const ttl = KNOWN_PROJECT_CONFIG_KEYS.pendingActionTtlDays!;
    expect(ttl.validate("7").ok).toBe(true);
    expect(ttl.validate("0").ok).toBe(false);
    expect(ttl.validate("ten").ok).toBe(false);

    expect(isKnownProjectConfigKey("baseBranch")).toBe(true);
    expect(isKnownProjectConfigKey("branchNamingConvention")).toBe(false);
    expect(isKnownProjectConfigKey("nope")).toBe(false);
  });
});
