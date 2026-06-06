-- Prototype rounds (PRD 0029 / Tranche A).
--
-- Two additive tables that model a *round* — a whole-design round, i.e. a
-- named, manifest-pinned snapshot of which page version ships together. This is
-- orthogonal to a per-page `version` (one page's iteration). Membership is row
-- presence in `prd_prototype_round_pages`: a page absent from the manifest is
-- not part of that round. The "current" round is the one with the maximum
-- `position` (mutable); earlier rounds are frozen by construction.
--
-- Back-fill preserves existing behaviour on upgrade: every existing prototype
-- gets a `v1` round whose manifest pins the latest non-archived version of
-- each of its pages. On a fresh/empty database the INSERT…SELECT statements are
-- no-ops. IDs are generated in SQL via `lower(hex(randomblob(16)))` and
-- timestamps via `unixepoch() * 1000` (timestamp_ms columns).
CREATE TABLE `prd_prototype_rounds` (
  `id` text PRIMARY KEY NOT NULL,
  `prototype_id` text NOT NULL REFERENCES `prd_prototypes`(`id`),
  `label` text NOT NULL,
  `summary` text,
  `position` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prd_prototype_rounds_prototype_id_idx` ON `prd_prototype_rounds` (`prototype_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prd_prototype_rounds_prototype_label_idx` ON `prd_prototype_rounds` (`prototype_id`, `label`);
--> statement-breakpoint
CREATE TABLE `prd_prototype_round_pages` (
  `id` text PRIMARY KEY NOT NULL,
  `round_id` text NOT NULL REFERENCES `prd_prototype_rounds`(`id`),
  `page_id` text NOT NULL REFERENCES `prd_prototype_pages`(`id`),
  `page_version_id` text NOT NULL REFERENCES `prd_prototype_page_versions`(`id`),
  `position` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prd_prototype_round_pages_round_id_idx` ON `prd_prototype_round_pages` (`round_id`);
--> statement-breakpoint
CREATE INDEX `prd_prototype_round_pages_page_id_idx` ON `prd_prototype_round_pages` (`page_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prd_prototype_round_pages_round_page_idx` ON `prd_prototype_round_pages` (`round_id`, `page_id`);
--> statement-breakpoint
INSERT INTO `prd_prototype_rounds` (`id`, `prototype_id`, `label`, `summary`, `position`, `created_at`)
SELECT lower(hex(randomblob(16))), p.id, 'v1', NULL, 0, unixepoch() * 1000
FROM `prd_prototypes` p;
--> statement-breakpoint
INSERT INTO `prd_prototype_round_pages` (`id`, `round_id`, `page_id`, `page_version_id`, `position`, `created_at`)
SELECT lower(hex(randomblob(16))), r.id, pg.id, lv.id, pg.position, unixepoch() * 1000
FROM `prd_prototype_pages` pg
JOIN `prd_prototype_rounds` r ON r.prototype_id = pg.prototype_id
JOIN `prd_prototype_page_versions` lv ON lv.id = (
  SELECT v.id FROM `prd_prototype_page_versions` v
  WHERE v.page_id = pg.id AND v.archived_at IS NULL
  ORDER BY v.created_at DESC, v.id DESC
  LIMIT 1
);
