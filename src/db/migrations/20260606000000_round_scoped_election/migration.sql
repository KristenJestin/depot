-- Round-scoped election (PRD 0030 / issue 01).
--
-- Move a page's election (chosen variant + arbitration record) from the page
-- (`prd_prototype_pages`) onto the round's manifest row
-- (`prd_prototype_round_pages`), so each design round carries its OWN decision.
-- Re-opening or cloning a round no longer drags a stale choice.
--
-- Additive + data-preserving (copy-then-keep, never drop-first):
--   1. ADD the four election columns to `prd_prototype_round_pages`.
--   2. Copy each page's existing election onto its manifest row in the *current*
--      round — the round with the maximum `position` for that page's prototype.
--      The copy runs BEFORE anything is removed; nothing is dropped.
--
-- The legacy columns on `prd_prototype_pages` (`chosen_variant_id`,
-- `decision_rationale`, `decided_by`, `decided_at`) are deliberately KEPT
-- (additive). Dropping them would require a table rebuild that risks the data
-- on a partial failure; per the AGENTS.md migration policy ("if in doubt, keep
-- the old columns") they are left in place and simply ignored by the domain.
--
-- `chosen_variant_id` is a plain id (no foreign key) — an FK would close a
-- pages → variants → versions → pages cycle that degrades Drizzle's
-- `.returning()` inference. Integrity is enforced in the domain.
--
-- On a fresh/empty database the UPDATE is a no-op.
ALTER TABLE `prd_prototype_round_pages` ADD COLUMN `chosen_variant_id` text;
--> statement-breakpoint
ALTER TABLE `prd_prototype_round_pages` ADD COLUMN `decision_rationale` text;
--> statement-breakpoint
ALTER TABLE `prd_prototype_round_pages` ADD COLUMN `decided_by` text;
--> statement-breakpoint
ALTER TABLE `prd_prototype_round_pages` ADD COLUMN `decided_at` integer;
--> statement-breakpoint
UPDATE `prd_prototype_round_pages`
SET
  `chosen_variant_id` = (
    SELECT pg.`chosen_variant_id` FROM `prd_prototype_pages` pg
    WHERE pg.`id` = `prd_prototype_round_pages`.`page_id`
  ),
  `decision_rationale` = (
    SELECT pg.`decision_rationale` FROM `prd_prototype_pages` pg
    WHERE pg.`id` = `prd_prototype_round_pages`.`page_id`
  ),
  `decided_by` = (
    SELECT pg.`decided_by` FROM `prd_prototype_pages` pg
    WHERE pg.`id` = `prd_prototype_round_pages`.`page_id`
  ),
  `decided_at` = (
    SELECT pg.`decided_at` FROM `prd_prototype_pages` pg
    WHERE pg.`id` = `prd_prototype_round_pages`.`page_id`
  )
WHERE
  -- only manifest rows of the CURRENT (max position) round of each prototype
  `round_id` IN (
    SELECT r.`id` FROM `prd_prototype_rounds` r
    JOIN `prd_prototype_pages` pg ON pg.`id` = `prd_prototype_round_pages`.`page_id`
    WHERE r.`prototype_id` = pg.`prototype_id`
      AND r.`position` = (
        SELECT MAX(r2.`position`) FROM `prd_prototype_rounds` r2
        WHERE r2.`prototype_id` = pg.`prototype_id`
      )
  )
  -- and only where the page actually carried an election (nothing to copy otherwise)
  AND EXISTS (
    SELECT 1 FROM `prd_prototype_pages` pg
    WHERE pg.`id` = `prd_prototype_round_pages`.`page_id`
      AND pg.`chosen_variant_id` IS NOT NULL
  );
