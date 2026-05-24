-- ADR as first-order entity (PRD 0010 / issue 01).
--
-- Adds `adrs` table to track architectural decisions natively in depot. An
-- ADR belongs to a `project`, may optionally cite the logical `prd` that
-- motivated it (link kept on `prds` not `prd_revisions` so the decision
-- survives spec forks), and has a small lifecycle: `proposed` → `accepted`,
-- or `accepted` → `superseded` by a newer ADR.
--
-- `number` is contiguous per project (1, 2, 3, …) and is rendered for humans
-- as `ADR-0001`. Allocation is done atomically in the domain layer inside a
-- transaction (`SELECT MAX(number)+1`), backed by the
-- `adrs_project_number_idx` unique index that doubles as a last-line guard
-- against duplicates if two callers race.
--
-- `superseded_by_adr_id` points to the newer ADR that replaced this one;
-- non-null iff `status = 'superseded'`. The two-row update (old → superseded,
-- new → accepted) is atomic via `supersedeAdr`.
CREATE TABLE `adrs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `prd_id` text REFERENCES `prds`(`id`),
  `number` integer NOT NULL,
  `title` text NOT NULL,
  `status` text DEFAULT 'proposed' NOT NULL,
  `body` text NOT NULL,
  `superseded_by_adr_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `adrs_project_id_idx` ON `adrs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `adrs_prd_id_idx` ON `adrs` (`prd_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `adrs_project_number_idx` ON `adrs` (`project_id`, `number`);
