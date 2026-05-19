CREATE TABLE `doc_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `name` text NOT NULL,
  `target_root` text NOT NULL,
  `target_pattern` text NOT NULL DEFAULT '**/*.md',
  `sources` text NOT NULL DEFAULT '[]',
  `language` text NOT NULL DEFAULT 'en',
  `style` text NOT NULL DEFAULT 'mixed',
  `audience` text,
  `routing_rules` text NOT NULL DEFAULT '[]',
  `topics_to_cover` text NOT NULL DEFAULT '[]',
  `topics_to_ignore` text NOT NULL DEFAULT '[]',
  `guardrails` text NOT NULL DEFAULT '[]',
  `commit_policy` text NOT NULL DEFAULT 'leave-in-working-tree',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `doc_profiles_project_name_idx` ON `doc_profiles` (`project_id`, `name`);
--> statement-breakpoint
CREATE TABLE `doc_sync_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_id` text NOT NULL REFERENCES `doc_profiles`(`id`),
  `triggered_by_prd_id` text REFERENCES `prd_revisions`(`id`),
  `since_ref` text,
  `until_ref` text,
  `ran_at` integer NOT NULL,
  `summary` text,
  `files_changed` text NOT NULL DEFAULT '[]'
);
--> statement-breakpoint
CREATE INDEX `doc_sync_runs_profile_idx` ON `doc_sync_runs` (`profile_id`);
--> statement-breakpoint
CREATE INDEX `doc_sync_runs_triggered_by_prd_idx` ON `doc_sync_runs` (`triggered_by_prd_id`);
--> statement-breakpoint
CREATE TABLE `project_config` (
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `key` text NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer NOT NULL,
  `updated_by_source` text NOT NULL DEFAULT 'ai',
  PRIMARY KEY(`project_id`, `key`)
);
