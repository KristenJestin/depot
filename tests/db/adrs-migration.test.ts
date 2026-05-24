import { describe, it, expect } from "vite-plus/test";
import { openDatabase } from "#/db/client";

describe("adrs migration", () => {
  it("applies the additive `adrs` table on a fresh :memory: db", () => {
    const { client } = openDatabase(":memory:");
    try {
      const tableRow = client
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='adrs'")
        .get() as { name: string } | undefined;
      expect(tableRow?.name).toBe("adrs");

      const cols = client.prepare("PRAGMA table_info(adrs)").all() as Array<{
        name: string;
        type: string;
        notnull: number;
      }>;
      const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
      expect(byName["id"]).toBeTruthy();
      expect(byName["project_id"]?.notnull).toBe(1);
      expect(byName["prd_id"]?.notnull).toBe(0); // nullable
      expect(byName["number"]?.notnull).toBe(1);
      expect(byName["title"]?.notnull).toBe(1);
      expect(byName["status"]?.notnull).toBe(1);
      expect(byName["body"]?.notnull).toBe(1);
      expect(byName["superseded_by_adr_id"]?.notnull).toBe(0);
      expect(byName["created_at"]?.notnull).toBe(1);
      expect(byName["updated_at"]?.notnull).toBe(1);

      const indexes = client.prepare("PRAGMA index_list(adrs)").all() as Array<{
        name: string;
        unique: number;
      }>;
      const idxNames = new Set(indexes.map((i) => i.name));
      expect(idxNames.has("adrs_project_id_idx")).toBe(true);
      expect(idxNames.has("adrs_prd_id_idx")).toBe(true);
      const unique = indexes.find((i) => i.name === "adrs_project_number_idx");
      expect(unique?.unique).toBe(1);
    } finally {
      client.close();
    }
  });
});
