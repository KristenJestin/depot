-- Design distillation marker (PRD 0028 / T4 — design lock gate).
--
-- One row per prd_revision once its prototype design has been distilled. Kept in
-- its own table rather than as columns on `prd_revisions` so the placement text
-- and the marker stay out of the core PRD row type that flows through the
-- web/API. The `prd ready` design-lock gate checks for this row; `distillDesign`
-- upserts it. Additive only: one new table.
CREATE TABLE `prd_design_lock` (
  `prd_revision_id` text PRIMARY KEY NOT NULL REFERENCES `prd_revisions`(`id`),
  `placement_spec` text NOT NULL,
  `distilled_at` integer NOT NULL
);
