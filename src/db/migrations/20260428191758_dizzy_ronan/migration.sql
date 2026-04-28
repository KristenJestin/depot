ALTER TABLE `prds` RENAME TO `prds_v1`;
--> statement-breakpoint
ALTER TABLE `tasks` RENAME TO `tasks_v1`;
--> statement-breakpoint
ALTER TABLE `reviews` RENAME TO `reviews_v1`;
--> statement-breakpoint
ALTER TABLE `activity_log` RENAME TO `activity_log_v1`;
--> statement-breakpoint
CREATE TABLE `prds` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `current_revision_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prd_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `prd_id` text NOT NULL REFERENCES `prds`(`id`),
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `workspace_id` text REFERENCES `workspaces`(`id`),
  `revision` integer NOT NULL DEFAULT 1,
  `title` text NOT NULL,
  `context` text,
  `scope` text,
  `status` text NOT NULL DEFAULT 'draft',
  `audit_cycles` integer NOT NULL DEFAULT 0,
  `current_phase` integer,
  `superseded_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `ready_at` integer,
  `activated_at` integer
);
--> statement-breakpoint
CREATE TABLE `reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `prd_revision_id` text NOT NULL REFERENCES `prd_revisions`(`id`),
  `type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'draft',
  `user_feedback` text,
  `phase_number` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `done_at` integer
);
--> statement-breakpoint
CREATE TABLE `tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `prd_revision_id` text NOT NULL REFERENCES `prd_revisions`(`id`),
  `position` integer NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `description_format` text NOT NULL DEFAULT 'structured_v1',
  `done_criteria` text NOT NULL,
  `depends_on` text NOT NULL DEFAULT '[]',
  `effort` text NOT NULL,
  `phase_number` integer,
  `status` text NOT NULL DEFAULT 'pending',
  `review_id` text REFERENCES `reviews`(`id`),
  `severity` text,
  `blocked_reason` text,
  `skip_reason` text,
  `created_at` integer NOT NULL,
  `started_at` integer,
  `completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `activity_log` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `workspace_id` text REFERENCES `workspaces`(`id`),
  `prd_revision_id` text REFERENCES `prd_revisions`(`id`),
  `task_id` text REFERENCES `tasks`(`id`),
  `event_type` text NOT NULL,
  `payload` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `prds` (`id`, `project_id`, `current_revision_id`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `project_id`, `id`, `created_at`, `updated_at`
FROM `prds_v1`;
--> statement-breakpoint
INSERT INTO `prd_revisions` (
  `id`, `prd_id`, `project_id`, `workspace_id`, `revision`,
  `title`, `context`, `scope`, `status`, `audit_cycles`,
  `current_phase`, `superseded_at`, `created_at`, `updated_at`,
  `ready_at`, `activated_at`
)
SELECT
  v.`id`,
  p.`id`,
  v.`project_id`,
  v.`workspace_id`,
  COALESCE(v.`revision`, 1),
  v.`title`,
  v.`context`,
  v.`scope`,
  v.`status`,
  COALESCE(v.`audit_cycles`, 0),
  v.`current_phase`,
  NULL,
  v.`created_at`,
  v.`updated_at`,
  v.`ready_at`,
  v.`activated_at`
FROM `prds_v1` v
JOIN `prds` p ON p.`current_revision_id` = v.`id`;
--> statement-breakpoint
INSERT INTO `reviews` (
  `id`, `prd_revision_id`, `type`, `status`, `user_feedback`,
  `phase_number`, `created_at`, `updated_at`, `done_at`
)
SELECT `id`, `prd_id`, `type`, `status`, `user_feedback`,
  `phase_number`, `created_at`, `updated_at`, `done_at`
FROM `reviews_v1`;
--> statement-breakpoint
INSERT INTO `tasks` (
  `id`, `prd_revision_id`, `position`, `title`, `description`,
  `description_format`, `done_criteria`, `depends_on`, `effort`,
  `phase_number`, `status`, `review_id`, `severity`,
  `blocked_reason`, `skip_reason`, `created_at`, `started_at`, `completed_at`
)
SELECT
  `id`, `prd_id`, `position`, `title`, `description`,
  `description_format`, `done_criteria`, `depends_on`, `effort`,
  `phase_number`, `status`, `review_id`, `severity`,
  `blocked_reason`, `skip_reason`, `created_at`, `started_at`, `completed_at`
FROM `tasks_v1`;
--> statement-breakpoint
INSERT INTO `activity_log` (
  `id`, `project_id`, `workspace_id`, `prd_revision_id`,
  `task_id`, `event_type`, `payload`, `created_at`
)
SELECT `id`, `project_id`, `workspace_id`, `prd_id`,
  `task_id`, `event_type`, `payload`, `created_at`
FROM `activity_log_v1`;
--> statement-breakpoint
DROP TABLE `activity_log_v1`;
--> statement-breakpoint
DROP TABLE `tasks_v1`;
--> statement-breakpoint
DROP TABLE `reviews_v1`;
--> statement-breakpoint
DROP TABLE `prds_v1`;
--> statement-breakpoint
CREATE INDEX `prds_project_id_idx` ON `prds` (`project_id`);
--> statement-breakpoint
CREATE INDEX `prds_current_revision_id_idx` ON `prds` (`current_revision_id`);
--> statement-breakpoint
CREATE INDEX `prd_revisions_prd_id_idx` ON `prd_revisions` (`prd_id`);
--> statement-breakpoint
CREATE INDEX `prd_revisions_project_id_idx` ON `prd_revisions` (`project_id`);
--> statement-breakpoint
CREATE INDEX `prd_revisions_workspace_id_idx` ON `prd_revisions` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `reviews_prd_revision_id_idx` ON `reviews` (`prd_revision_id`);
--> statement-breakpoint
CREATE INDEX `tasks_prd_revision_id_idx` ON `tasks` (`prd_revision_id`);
--> statement-breakpoint
CREATE INDEX `tasks_review_id_idx` ON `tasks` (`review_id`);
--> statement-breakpoint
CREATE INDEX `activity_log_project_id_idx` ON `activity_log` (`project_id`);
--> statement-breakpoint
CREATE INDEX `activity_log_workspace_id_idx` ON `activity_log` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `activity_log_prd_revision_id_idx` ON `activity_log` (`prd_revision_id`);
--> statement-breakpoint
CREATE INDEX `activity_log_task_id_idx` ON `activity_log` (`task_id`);
