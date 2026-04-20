CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`prd_id` text,
	`task_id` text,
	`event_type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_activity_log_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
	CONSTRAINT `fk_activity_log_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_activity_log_prd_id_prds_id_fk` FOREIGN KEY (`prd_id`) REFERENCES `prds`(`id`),
	CONSTRAINT `fk_activity_log_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`)
);
--> statement-breakpoint
CREATE TABLE `prds` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`context` text,
	`scope` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`committed_at` text,
	`activated_at` text,
	CONSTRAINT `fk_prds_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
	CONSTRAINT `fk_prds_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY,
	`prd_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`done_criteria` text NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`effort` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`blocked_reason` text,
	`skip_reason` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	CONSTRAINT `fk_tasks_prd_id_prds_id_fk` FOREIGN KEY (`prd_id`) REFERENCES `prds`(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`path` text NOT NULL UNIQUE,
	`label` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_workspaces_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
