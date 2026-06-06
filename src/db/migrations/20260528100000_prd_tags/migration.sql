-- PRD tags M:N (PRD 0019 / T1).
--
-- Free-form tags attached to a logical PRD (`prds.id`, not a specific
-- revision) so the thematic grouping survives forks. A composite primary
-- key `(prd_id, tag)` makes `addTag` idempotent at the schema level —
-- inserting the same pair twice is a no-op on `INSERT OR IGNORE`.
-- The inverse index `idx_prd_tags_tag_prd` powers `listPrdsForTag`
-- ("what PRDs carry this tag?") in O(log n).
--
-- Tag validation (kebab-case, max 50 chars) lives in the domain layer
-- (`src/modules/prds/tags.ts`) rather than as a CHECK constraint, to
-- keep error messages friendly and the migration additive.
CREATE TABLE `prd_tags` (
  `prd_id` text NOT NULL REFERENCES `prds`(`id`),
  `tag` text NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`prd_id`, `tag`)
);
--> statement-breakpoint
CREATE INDEX `idx_prd_tags_tag_prd` ON `prd_tags` (`tag`, `prd_id`);
