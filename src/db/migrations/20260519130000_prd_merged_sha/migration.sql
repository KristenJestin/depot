-- Post-merge SHA so the diff range survives a squash merge that garbage-
-- collects the feature branch HEAD that activatedAtSha / doneAtSha point at.
ALTER TABLE `prd_revisions` ADD COLUMN `merged_at_sha` text;
