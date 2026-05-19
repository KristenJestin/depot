-- Auditor split (standards/spec axis) + triage state on tasks + source on
-- activity log. Note: SQLite has no native UPDATE for review tasks to flip
-- the existing default; review tasks created before this migration keep
-- the column-level default of `ready-for-agent`. Manual triage state
-- assignment in the new code path will overwrite as needed.

ALTER TABLE `tasks` ADD COLUMN `axis` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `triage_state` text NOT NULL DEFAULT 'ready-for-agent';
--> statement-breakpoint
ALTER TABLE `activity_log` ADD COLUMN `source` text NOT NULL DEFAULT 'ai';
