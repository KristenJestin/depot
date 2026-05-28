import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Per-scenario temp-dir helper. Each scenario gets a fresh `mkdtemp` root,
 * and any sub-dir created via `.create()` lives underneath it so a single
 * `rm -rf <root>` cleans the whole world.
 */
export type DirHelper = {
  readonly root: string;
  create(name?: string): Promise<string>;
};

export type DirHandle = {
  helper: DirHelper;
  cleanup(): Promise<void>;
};

const PREFIX = "depot-e2e-";

export async function createDirHelper(): Promise<DirHandle> {
  const root = await mkdtemp(path.join(tmpdir(), PREFIX));
  let counter = 0;

  const helper: DirHelper = {
    root,
    async create(name?: string): Promise<string> {
      counter += 1;
      const slug = sanitize(name) ?? `dir-${counter}`;
      const target = path.join(root, slug);
      await mkdir(target, { recursive: true });
      return target;
    },
  };

  return {
    helper,
    async cleanup() {
      if (process.env["E2E_KEEP_TMP"] === "1") {
        process.stdout.write(`  [e2e] keeping tmp dir for inspection: ${root}\n`);
        return;
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

function sanitize(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
