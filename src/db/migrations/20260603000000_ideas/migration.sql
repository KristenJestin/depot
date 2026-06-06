-- Idea capture (PRD 0027 / T1).
--
-- Two additive tables. `ideas` is a deliberately thin, project-scoped capture
-- entity that sits before the commitment a PRD represents: title + optional
-- markdown body + optional kebab-case tag, with a triage lifecycle
-- (`open → promoted | dropped`, `dropped → open`) enforced at the domain layer.
-- `promoted_prd_id` records provenance and references the *logical* PRD so it
-- survives forks. `prd_ideas` is the M:N reference join ("which ideas motivated
-- this PRD?"), modeled on `prd_tags` / `prd_depends_on` and likewise attached
-- to the logical PRD so it survives forks. Referencing an idea here does not
-- change its status; `promote` is the only path that flips an idea to
-- `promoted`.
CREATE TABLE `ideas` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `title` text NOT NULL,
  `body` text,
  `tag` text,
  `status` text DEFAULT 'open' NOT NULL,
  `promoted_prd_id` text REFERENCES `prds`(`id`),
  `dropped_reason` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ideas_project_id_idx` ON `ideas` (`project_id`);
--> statement-breakpoint
CREATE INDEX `ideas_project_status_idx` ON `ideas` (`project_id`, `status`);
--> statement-breakpoint
CREATE INDEX `ideas_promoted_prd_id_idx` ON `ideas` (`promoted_prd_id`);
--> statement-breakpoint
CREATE TABLE `prd_ideas` (
  `prd_id` text NOT NULL REFERENCES `prds`(`id`),
  `idea_id` text NOT NULL REFERENCES `ideas`(`id`),
  `created_at` integer NOT NULL,
  PRIMARY KEY(`prd_id`, `idea_id`)
);
--> statement-breakpoint
CREATE INDEX `prd_ideas_idea_id_idx` ON `prd_ideas` (`idea_id`);
