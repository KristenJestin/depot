/**
 * Known project config keys.
 *
 * Each key declares its label/description/default plus a `validate`
 * function. The web settings editor renders one field per key in this
 * map; the API validates `PATCH /api/projects/:id/config` against the
 * same map. Unknown keys are refused at the API layer.
 */

export type ProjectConfigKeyDescriptor = {
  label: string;
  description: string;
  default: string | null;
  validate: (value: string) => { ok: true } | { ok: false; reason: string };
};

export const KNOWN_PROJECT_CONFIG_KEYS: Record<string, ProjectConfigKeyDescriptor> = {
  baseBranch: {
    label: "Base branch",
    description:
      "Default branch the project sits on (used by /depot-ship to pull before mark-done).",
    default: "main",
    validate: (v) =>
      /^[a-zA-Z0-9_./-]+$/.test(v)
        ? { ok: true }
        : { ok: false, reason: "Branch names must match [a-zA-Z0-9_./-]+" },
  },
  defaultDocProfile: {
    label: "Default doc profile",
    description:
      "Name of the doc profile used by /depot-doc when no profile name is given. Must exist.",
    default: null,
    validate: (v) =>
      v.length > 0 ? { ok: true } : { ok: false, reason: "Profile name must be non-empty" },
  },
  branchNamingConvention: {
    label: "Branch naming convention",
    description:
      "Pattern used by orchestrators to derive branch names from PRD IDs (e.g. 'feat/{prdId}').",
    default: "feat/{prdId}",
    validate: (v) =>
      v.includes("{prdId}")
        ? { ok: true }
        : { ok: false, reason: "Pattern must contain '{prdId}' placeholder" },
  },
  protectedFiles: {
    label: "Protected files",
    description:
      "Comma-separated paths or prefixes the web commit endpoint refuses to stage (e.g. '.env,secrets').",
    default: ".env,secrets",
    validate: () => ({ ok: true }),
  },
  pendingActionTtlDays: {
    label: "Pending action TTL (days)",
    description:
      "Number of days a pending action stays alive before being auto-dismissed as 'expired'.",
    default: "7",
    validate: (v) =>
      /^\d+$/.test(v) && Number(v) > 0
        ? { ok: true }
        : { ok: false, reason: "TTL must be a positive integer (days)" },
  },
};

export function isKnownProjectConfigKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(KNOWN_PROJECT_CONFIG_KEYS, key);
}
