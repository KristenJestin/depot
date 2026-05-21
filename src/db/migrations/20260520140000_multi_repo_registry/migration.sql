-- Optional per-project registry of the git repos that make up a project.
-- A project with no rows here falls back to a single implicit repo resolved
-- from the workspace path. Each repo carries its own base branch.
CREATE TABLE `project_repo` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `name` text NOT NULL,
  `path` text NOT NULL,
  `is_primary` integer NOT NULL DEFAULT 0,
  `base_branch` text NOT NULL DEFAULT 'main',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_repo_project_id_idx` ON `project_repo` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_repo_project_name_idx` ON `project_repo` (`project_id`, `name`);
--> statement-breakpoint
-- Repo target for `kind: command` directives: auto | all | workspace | <repo-name>.
ALTER TABLE `project_directives` ADD COLUMN `repo_target` text NOT NULL DEFAULT 'auto';
