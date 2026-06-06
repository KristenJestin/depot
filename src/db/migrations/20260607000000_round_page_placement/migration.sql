-- Per-(round, page) placement (PRD 0030 / issue 02).
--
-- The distilled placement spec — the validated layout the dev/coder implements
-- — becomes a per-`(round, page)` artifact, authored on the fly and stored OUT
-- of the manifest hot path (`prd_prototype_round_pages`). One row per
-- `(round, page)`; `placement_spec` is one markdown field structured by
-- convention (Regions / Order / Hierarchy / States / Interactions). The section
-- guard lives in the domain (`distillPagePlacement`).
--
-- Additive + data-preserving:
--   * CREATE the new `prd_round_page_design` table — nothing is dropped.
--   * The global `prd_design_lock` (one blob per PRD revision, PRD 0028) is
--     deliberately KEPT. A global blob can't be auto-split per page, so it is
--     NOT migrated into the per-page table and NOT dropped — it stays readable
--     for already-distilled PRDs. The per-page system applies going forward.
--
-- On a fresh/empty database this is a plain CREATE TABLE; there is nothing to
-- back-fill.
--
-- `round_id` / `page_id` are foreign keys (they do not close the prototype-graph
-- `pages → variants → versions → pages` cycle), with the pair as the primary
-- key so a `(round, page)` carries at most one placement.
CREATE TABLE `prd_round_page_design` (
  `round_id` text NOT NULL REFERENCES `prd_prototype_rounds`(`id`),
  `page_id` text NOT NULL REFERENCES `prd_prototype_pages`(`id`),
  `placement_spec` text NOT NULL,
  `distilled_at` integer NOT NULL,
  PRIMARY KEY(`round_id`, `page_id`)
);
--> statement-breakpoint
CREATE INDEX `prd_round_page_design_page_id_idx` ON `prd_round_page_design` (`page_id`);
