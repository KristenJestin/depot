-- Data-only cleanup. The `branchNamingConvention` project config key was
-- removed from `KNOWN_PROJECT_CONFIG_KEYS` and from the `KNOWN_KEYS` set in
-- `src/modules/projects/config.ts` because depot never read, wrote, or
-- enforced it. This drops any leftover rows that users stored under that key
-- so the config listing/editor doesn't surface orphaned data. No schema
-- change.
DELETE FROM project_config WHERE key = 'branchNamingConvention';
