CREATE TABLE `project_directives` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `scope` text NOT NULL,
  `title` text NOT NULL,
  `instruction` text NOT NULL,
  `kind` text NOT NULL,
  `blocking` integer NOT NULL DEFAULT 1,
  `position` integer NOT NULL DEFAULT 0,
  `enabled` integer NOT NULL DEFAULT 1,
  `last_run_at` integer,
  `last_run_status` text,
  `last_run_output` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_directives_project_scope_idx` ON `project_directives` (`project_id`, `scope`, `enabled`, `position`);
