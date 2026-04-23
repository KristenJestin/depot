CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`prd_id` text,
	`task_id` text,
	`event_type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_activity_log_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
	CONSTRAINT `fk_activity_log_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_activity_log_prd_id_prds_id_fk` FOREIGN KEY (`prd_id`) REFERENCES `prds`(`id`),
	CONSTRAINT `fk_activity_log_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`)
);
--> statement-breakpoint
CREATE TABLE `prds` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`parent_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`context` text,
	`scope` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ready_at` integer,
	`activated_at` integer,
	CONSTRAINT `fk_prds_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
	CONSTRAINT `fk_prds_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_prds_parent_id_prds_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `prds`(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY,
	`prd_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`description_format` text DEFAULT 'structured_v1' NOT NULL,
	`done_criteria` text NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`effort` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`blocked_reason` text,
	`skip_reason` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	CONSTRAINT `fk_tasks_prd_id_prds_id_fk` FOREIGN KEY (`prd_id`) REFERENCES `prds`(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`path` text NOT NULL UNIQUE,
	`label` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_workspaces_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE INDEX `activity_log_project_id_idx` ON `activity_log` (`project_id`);--> statement-breakpoint
CREATE INDEX `activity_log_workspace_id_idx` ON `activity_log` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `activity_log_prd_id_idx` ON `activity_log` (`prd_id`);--> statement-breakpoint
CREATE INDEX `activity_log_task_id_idx` ON `activity_log` (`task_id`);--> statement-breakpoint
CREATE INDEX `prds_project_id_idx` ON `prds` (`project_id`);--> statement-breakpoint
CREATE INDEX `prds_workspace_id_idx` ON `prds` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `prds_parent_id_idx` ON `prds` (`parent_id`);--> statement-breakpoint
CREATE INDEX `tasks_prd_id_idx` ON `tasks` (`prd_id`);--> statement-breakpoint
CREATE INDEX `workspaces_project_id_idx` ON `workspaces` (`project_id`);