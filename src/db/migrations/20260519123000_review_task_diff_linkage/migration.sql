-- Web diff viewer: link review tasks to file/line ranges in the diff.
ALTER TABLE `tasks` ADD COLUMN `linked_file_path` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `linked_start_line` integer;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `linked_end_line` integer;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `linked_diff_sha` text;
