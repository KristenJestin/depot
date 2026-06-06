-- Add an optional `target_version` column to `prds` for milestone / release
-- grouping (PRD 0019 / T3). Free-form text — semver, dates, codenames are
-- all acceptable. Validation lives in the domain layer (`isValidMilestone`).
--
-- Additive migration: nullable column + index. Existing rows pick up
-- NULL automatically; nothing else changes.
ALTER TABLE `prds` ADD `target_version` text;--> statement-breakpoint
CREATE INDEX `prds_target_version_idx` ON `prds` (`target_version`);
