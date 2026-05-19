-- PRD schema enrichment: structured sections, SHA capture, task kind,
-- user stories, out-of-scope items, phase snapshots.

ALTER TABLE `prd_revisions` ADD COLUMN `problem` text;
--> statement-breakpoint
ALTER TABLE `prd_revisions` ADD COLUMN `solution` text;
--> statement-breakpoint
ALTER TABLE `prd_revisions` ADD COLUMN `implementation_decisions` text;
--> statement-breakpoint
ALTER TABLE `prd_revisions` ADD COLUMN `testing_decisions` text;
--> statement-breakpoint
ALTER TABLE `prd_revisions` ADD COLUMN `activated_at_sha` text;
--> statement-breakpoint
ALTER TABLE `prd_revisions` ADD COLUMN `done_at_sha` text;
--> statement-breakpoint
ALTER TABLE `prd_revisions` ADD COLUMN `worktree_path` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `kind` text NOT NULL DEFAULT 'slice';
--> statement-breakpoint
CREATE TABLE `user_stories` (
  `id` text PRIMARY KEY NOT NULL,
  `prd_revision_id` text NOT NULL REFERENCES `prd_revisions`(`id`),
  `position` integer NOT NULL DEFAULT 0,
  `as_role` text NOT NULL,
  `want` text NOT NULL,
  `so` text NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_stories_prd_revision_id_idx` ON `user_stories` (`prd_revision_id`);
--> statement-breakpoint
CREATE INDEX `user_stories_position_idx` ON `user_stories` (`prd_revision_id`, `position`);
--> statement-breakpoint
CREATE TABLE `task_user_stories` (
  `task_id` text NOT NULL REFERENCES `tasks`(`id`),
  `user_story_id` text NOT NULL REFERENCES `user_stories`(`id`),
  PRIMARY KEY(`task_id`, `user_story_id`)
);
--> statement-breakpoint
CREATE INDEX `task_user_stories_story_idx` ON `task_user_stories` (`user_story_id`);
--> statement-breakpoint
CREATE TABLE `out_of_scope_items` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `prd_revision_id` text REFERENCES `prd_revisions`(`id`),
  `title` text NOT NULL,
  `reason` text NOT NULL,
  `decided_at` integer NOT NULL,
  `decided_by` text,
  `linked_review_task_id` text REFERENCES `tasks`(`id`),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `out_of_scope_items_project_id_idx` ON `out_of_scope_items` (`project_id`);
--> statement-breakpoint
CREATE INDEX `out_of_scope_items_prd_revision_id_idx` ON `out_of_scope_items` (`prd_revision_id`);
--> statement-breakpoint
CREATE TABLE `prd_phase_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `prd_revision_id` text NOT NULL REFERENCES `prd_revisions`(`id`),
  `phase_number` integer NOT NULL,
  `advanced_at_sha` text,
  `advanced_at` integer NOT NULL,
  `review_brief` text,
  `suggested_commit_message` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prd_phase_snapshots_prd_phase_idx` ON `prd_phase_snapshots` (`prd_revision_id`, `phase_number`);
