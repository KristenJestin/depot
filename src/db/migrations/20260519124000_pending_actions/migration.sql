CREATE TABLE `pending_actions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `kind` text NOT NULL,
  `payload` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'pending',
  `source_prd_id` text REFERENCES `prd_revisions`(`id`),
  `slash_command` text NOT NULL,
  `human_readable_label` text NOT NULL,
  `created_at` integer NOT NULL,
  `consumed_at` integer,
  `consumed_by_source` text
);
--> statement-breakpoint
CREATE INDEX `pending_actions_project_status_idx` ON `pending_actions` (`project_id`, `status`, `created_at`);
