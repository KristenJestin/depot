-- Suggested commit message for the whole PRD. Phase snapshots may still hold
-- phase-specific suggestions, but this gives single-commit PRDs a stable home.
ALTER TABLE `prd_revisions` ADD COLUMN `suggested_commit_message` text;
