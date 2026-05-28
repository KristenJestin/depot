-- Project directive `category` dimension (PRD 0013 / T1).
--
-- Adds a `category` column on `project_directives` so each directive can be
-- routed to the matching agent template (prd / dev / coder / auditor / doc /
-- ship). The column is added nullable here — SQLite cannot retro-fit NOT NULL
-- via ALTER TABLE without recreating the table, and we don't want to drop &
-- copy a live table just for that. The backfill below populates every
-- existing row from its scope; from this migration onwards, the domain layer
-- (`createDirective`) rejects null values, so the column is effectively
-- non-null at the application boundary.
--
-- Backfill mapping (matches the issue spec):
--   pre-doc-sync → doc
--   pre-ship     → ship
--   pre-commit   → coder
--   pre-review   → dev      (default; auditor-flavoured directives can be
--                            re-categorised post-migration via UPDATE)
--   always       → dev      (most common today; adjustable post-migration)
--   on-error     → dev      (default; adjustable post-migration)
ALTER TABLE `project_directives` ADD COLUMN `category` text;
--> statement-breakpoint
UPDATE `project_directives` SET `category` = CASE `scope`
    WHEN 'pre-doc-sync' THEN 'doc'
    WHEN 'pre-ship'     THEN 'ship'
    WHEN 'pre-commit'   THEN 'coder'
    WHEN 'pre-review'   THEN 'dev'
    WHEN 'always'       THEN 'dev'
    WHEN 'on-error'     THEN 'dev'
    ELSE 'dev'
  END
  WHERE `category` IS NULL;
