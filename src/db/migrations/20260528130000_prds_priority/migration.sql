-- PRD 0019 / T5 — add `priority` enum column to `prds`.
--
-- Free-form enum (`critical|high|normal|low`) validated at the domain layer
-- (`isValidPrdPriority`). `normal` is the silent default for newly-created
-- PRDs; legacy rows pick it up automatically because the column is
-- `NOT NULL DEFAULT 'normal'` so SQLite backfills every existing row with
-- that value when the ALTER TABLE runs.
--
-- Additive migration: one ALTER TABLE + one index. Nothing else moves.
ALTER TABLE `prds` ADD `priority` text NOT NULL DEFAULT 'normal';--> statement-breakpoint
CREATE INDEX `idx_prds_priority` ON `prds` (`priority`);
