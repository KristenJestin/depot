-- Prototypes for iterative UI design on a PRD revision (PRD 0025 / T1).
--
-- Five additive tables modelling the four-level hierarchy
-- `Prototype → Page → Version → Variant` plus per-variant feedback. A
-- prototype is attached to a `prd_revision` so forks recopy a self-contained
-- snapshot. Pages carry a stable slug (the link convention
-- `data-depot-page="<slug>"` resolves through it). Each page version is
-- frozen (older versions stay readable for audit); the agent iterates by
-- minting a new version. Exactly one variant per page version carries
-- `is_main = 1` — enforced at the domain layer via an atomic transaction in
-- `setMainVariant`.
--
-- Feedback status is intentionally just `open | ignored`. The "addressed"
-- bucket the UI surfaces is *derived*: a feedback that is `open` on a
-- variant whose page now has a newer non-archived version is treated as
-- addressed (the agent moved on by minting that newer version). Storing it
-- would couple feedback state to version churn. `resolution_*` are optional
-- annotations the agent writes for the audit log; `ignored_reason` is
-- required at the domain layer whenever status flips to `ignored`.
CREATE TABLE `prd_prototypes` (
  `id` text PRIMARY KEY NOT NULL,
  `prd_revision_id` text NOT NULL REFERENCES `prd_revisions`(`id`),
  `slug` text NOT NULL,
  `description` text,
  `created_at` integer NOT NULL,
  `archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `prd_prototypes_prd_revision_id_idx` ON `prd_prototypes` (`prd_revision_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prd_prototypes_prd_revision_slug_idx` ON `prd_prototypes` (`prd_revision_id`, `slug`);
--> statement-breakpoint
CREATE TABLE `prd_prototype_pages` (
  `id` text PRIMARY KEY NOT NULL,
  `prototype_id` text NOT NULL REFERENCES `prd_prototypes`(`id`),
  `slug` text NOT NULL,
  `title` text NOT NULL,
  `position` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prd_prototype_pages_prototype_id_idx` ON `prd_prototype_pages` (`prototype_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prd_prototype_pages_prototype_slug_idx` ON `prd_prototype_pages` (`prototype_id`, `slug`);
--> statement-breakpoint
CREATE TABLE `prd_prototype_page_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `page_id` text NOT NULL REFERENCES `prd_prototype_pages`(`id`),
  `label` text NOT NULL,
  `summary` text,
  `created_at` integer NOT NULL,
  `archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `prd_prototype_page_versions_page_id_idx` ON `prd_prototype_page_versions` (`page_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prd_prototype_page_versions_page_label_idx` ON `prd_prototype_page_versions` (`page_id`, `label`);
--> statement-breakpoint
CREATE TABLE `prd_prototype_variants` (
  `id` text PRIMARY KEY NOT NULL,
  `page_version_id` text NOT NULL REFERENCES `prd_prototype_page_versions`(`id`),
  `label` text NOT NULL,
  `title` text NOT NULL,
  `html_content` text NOT NULL,
  `is_main` integer DEFAULT false NOT NULL,
  `position` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prd_prototype_variants_page_version_id_idx` ON `prd_prototype_variants` (`page_version_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prd_prototype_variants_page_version_label_idx` ON `prd_prototype_variants` (`page_version_id`, `label`);
--> statement-breakpoint
CREATE TABLE `prd_prototype_feedback` (
  `id` text PRIMARY KEY NOT NULL,
  `variant_id` text NOT NULL REFERENCES `prd_prototype_variants`(`id`),
  `text` text NOT NULL,
  `selector_css` text,
  `status` text DEFAULT 'open' NOT NULL,
  `resolution_note` text,
  `resolution_via_variant_id` text,
  `resolved_at` integer,
  `ignored_reason` text,
  `ignored_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prd_prototype_feedback_variant_id_idx` ON `prd_prototype_feedback` (`variant_id`);
--> statement-breakpoint
CREATE INDEX `prd_prototype_feedback_variant_status_idx` ON `prd_prototype_feedback` (`variant_id`, `status`);
