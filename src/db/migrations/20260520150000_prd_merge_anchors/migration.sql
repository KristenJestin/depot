-- Multi-repo merge anchors. Replaces the single `prd_revision.merged_at_sha`
-- column for multi-repo projects: a PRD that lands across N repos gets N rows
-- here, one per `{repo, merge_sha}` pair. `repo_id` is null for the implicit
-- mono-repo; `repo_name`/`repo_path` are denormalised so the anchor survives a
-- later `project_repo` deletion.
CREATE TABLE `prd_merge` (
  `id` text PRIMARY KEY NOT NULL,
  `prd_revision_id` text NOT NULL REFERENCES `prd_revisions`(`id`),
  `repo_id` text REFERENCES `project_repo`(`id`),
  `repo_name` text NOT NULL,
  `repo_path` text NOT NULL,
  `merge_sha` text NOT NULL,
  `merged_at` integer NOT NULL,
  `captured_from` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prd_merge_prd_revision_id_idx` ON `prd_merge` (`prd_revision_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prd_merge_prd_revision_repo_name_idx` ON `prd_merge` (`prd_revision_id`, `repo_name`);
--> statement-breakpoint
-- Data migration: backfill one `prd_merge` row per legacy `merged_at_sha`.
-- The historical SHA carries no repo identity, so we attribute it to: the
-- single `project_repo` when the project has exactly one, otherwise the
-- `is_primary` repo, otherwise the implicit `(default)` repo (repo_id null).
-- `merged_at_sha` is left in place as a legacy-readable fallback.
INSERT INTO `prd_merge` (
  `id`, `prd_revision_id`, `repo_id`, `repo_name`, `repo_path`,
  `merge_sha`, `merged_at`, `captured_from`, `created_at`, `updated_at`
)
SELECT
  lower(hex(randomblob(16))),
  pr.`id`,
  (
    SELECT picked.`id` FROM `project_repo` picked
    WHERE picked.`project_id` = pr.`project_id`
    ORDER BY picked.`is_primary` DESC, picked.`created_at` ASC
    LIMIT 1
  ),
  COALESCE(
    (
      SELECT picked.`name` FROM `project_repo` picked
      WHERE picked.`project_id` = pr.`project_id`
      ORDER BY picked.`is_primary` DESC, picked.`created_at` ASC
      LIMIT 1
    ),
    '(default)'
  ),
  COALESCE(
    (
      SELECT picked.`path` FROM `project_repo` picked
      WHERE picked.`project_id` = pr.`project_id`
      ORDER BY picked.`is_primary` DESC, picked.`created_at` ASC
      LIMIT 1
    ),
    (
      SELECT w.`path` FROM `workspaces` w
      WHERE w.`id` = pr.`workspace_id`
      LIMIT 1
    ),
    ''
  ),
  pr.`merged_at_sha`,
  pr.`updated_at`,
  'explicit',
  pr.`updated_at`,
  pr.`updated_at`
FROM `prd_revisions` pr
WHERE pr.`merged_at_sha` IS NOT NULL AND pr.`merged_at_sha` <> '';
