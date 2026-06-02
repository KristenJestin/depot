-- PRD annexes (PRD 0024 / T1).
--
-- A named text artifact attached to a PRD *revision* (`prd_revisions.id`, not
-- the logical PRD) so each revision stays self-contained and is recopied at
-- fork — annexes are substance (like body/tasks/reviews), not metadata.
--
-- `name` is a kebab-case slug, unique per revision, that doubles as the key in
-- inline `[annex: <name>]` body mentions. `kind` is a render hint
-- (html/markdown/code/text), `description` a free-form relevance summary, and
-- `content` the full text blob. Validation (name shape, 2 MB content cap,
-- description length, kind enum) lives in the domain layer
-- (`src/modules/prds/annexes.ts`) to keep error messages friendly and the
-- migration additive.
--
-- The `prd_annexes_prd_revision_id_idx` index powers `listAnnexes` /
-- `extractAnnexRefs` lookups; the `prd_annexes_prd_revision_name_idx` unique
-- index enforces one annex per `(revision, name)` and backs the
-- `addAnnex` existence check (with `--replace` to overwrite).
CREATE TABLE `prd_annexes` (
  `id` text PRIMARY KEY NOT NULL,
  `prd_revision_id` text NOT NULL REFERENCES `prd_revisions`(`id`),
  `name` text NOT NULL,
  `kind` text NOT NULL,
  `description` text,
  `content` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prd_annexes_prd_revision_id_idx` ON `prd_annexes` (`prd_revision_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prd_annexes_prd_revision_name_idx` ON `prd_annexes` (`prd_revision_id`, `name`);
