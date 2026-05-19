import { Effect } from "effect";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Capture the current HEAD SHA in a given path.
 * Returns `null` when the directory is not a git repo (the most common
 * non-error case) or when `git` is unavailable. Never throws — callers
 * treat SHA capture as best-effort enrichment, not as a load-bearing
 * invariant.
 */
export const captureSha = (cwd: string): Effect.Effect<string | null, never> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "HEAD"]);
      const sha = stdout.trim();
      return sha.length > 0 ? sha : null;
    },
    catch: () => null,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));
