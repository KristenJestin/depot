-- PRD ↔ repo M:N association and task ↔ repo 0..1 link (PRD 0005 / issue 01).
--
-- Two additive changes that together close the modelling gap between PRDs,
-- tasks, and the `project_repo` registry:
--
-- 1. `prd_repo`: M:N declaring which `project_repo` rows a PRD revision
--    touches. Posted on `prd_revisions` (not `prds`) so a fork can widen or
--    narrow the scope. Cardinality 0 is valid (mono-repo, or not yet
--    declared). A unique index on `(prd_revision_id, repo_id)` makes
--    add-twice idempotent at the schema level.
--
-- 2. `tasks.repo_id` (nullable): the single `project_repo` a task is
--    attached to. Always nullable, even in multi-repo projects, for changes
--    that don't belong to any registered repo (e.g. a CLAUDE.md at the
--    shell root). Cross-entity validation (`repo_id` must be in the parent
--    PRD's `prd_repo`) lives in the domain layer, not the schema.
CREATE TABLE `prd_repo` (
  `id` text PRIMARY KEY NOT NULL,
  `prd_revision_id` text NOT NULL REFERENCES `prd_revisions`(`id`),
  `repo_id` text NOT NULL REFERENCES `project_repo`(`id`),
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prd_repo_prd_revision_id_idx` ON `prd_repo` (`prd_revision_id`);
--> statement-breakpoint
CREATE INDEX `prd_repo_repo_id_idx` ON `prd_repo` (`repo_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prd_repo_prd_revision_repo_idx` ON `prd_repo` (`prd_revision_id`, `repo_id`);
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `repo_id` text REFERENCES `project_repo`(`id`);
