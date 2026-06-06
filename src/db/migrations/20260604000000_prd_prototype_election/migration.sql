-- Prototype variant election (PRD 0028 / T1 — design lock).
--
-- A page can elect ONE variant as THE design to build, distinct from per-version
-- `is_main` (a within-tree primacy hint). The election lives on the page,
-- together with its arbitration record (rationale / who / when), so the dev
-- handoff reads a decided design rather than raw mockups. All four columns are
-- nullable — a page is "no design chosen yet" until `electVariant` sets them.
--
-- Additive only: four `ADD COLUMN` on `prd_prototype_pages`. `chosen_variant_id`
-- is a plain id (no foreign key): an FK would close a pages → variants →
-- versions → pages cycle that degrades Drizzle's `.returning()` inference.
-- Integrity is enforced in the domain (`electVariant` / `removeVariant`).
ALTER TABLE `prd_prototype_pages` ADD COLUMN `chosen_variant_id` text;
--> statement-breakpoint
ALTER TABLE `prd_prototype_pages` ADD COLUMN `decision_rationale` text;
--> statement-breakpoint
ALTER TABLE `prd_prototype_pages` ADD COLUMN `decided_by` text;
--> statement-breakpoint
ALTER TABLE `prd_prototype_pages` ADD COLUMN `decided_at` integer;
