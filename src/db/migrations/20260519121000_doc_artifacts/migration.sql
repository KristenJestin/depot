CREATE TABLE `doc_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `workspace_id` text REFERENCES `workspaces`(`id`),
  `kind` text NOT NULL,
  `path` text NOT NULL,
  `number` integer,
  `title` text NOT NULL,
  `status` text,
  `superseded_by` text,
  `linked_prd_revision_id` text REFERENCES `prd_revisions`(`id`),
  `last_modified_at` integer NOT NULL,
  `last_modified_by_source` text NOT NULL DEFAULT 'ai',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `doc_artifacts_project_kind_idx` ON `doc_artifacts` (`project_id`, `kind`);
--> statement-breakpoint
CREATE INDEX `doc_artifacts_project_path_idx` ON `doc_artifacts` (`project_id`, `path`);
