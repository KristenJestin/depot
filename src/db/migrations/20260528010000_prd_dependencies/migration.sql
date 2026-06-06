-- PRD ↔ PRD dependency DAG (PRD 0019 / T2).
--
-- Declares a hard dependency between two logical PRDs ("this PRD depends on
-- that one") as an M:N table. Both columns reference the logical PRDs (not
-- revisions) so a dependency declared before a fork survives the fork.
--
-- Acyclicity is enforced at insert time in the domain layer via DFS — see
-- `src/modules/prds/dependencies.ts`. The CHECK constraint refuses the
-- trivial self-dependency at the SQL layer so even raw SQL inserts can't
-- silently land an A→A edge.
--
-- The composite PRIMARY KEY makes adding the same edge twice a no-op-by-error
-- and lets the domain layer rely on it for idempotency. The
-- `prd_depends_on_inverse_idx` covers the reverse lookup `"who depends on me"`
-- without scanning the whole table.
CREATE TABLE `prd_depends_on` (
  `prd_id` text NOT NULL REFERENCES `prds`(`id`),
  `depends_on_prd_id` text NOT NULL REFERENCES `prds`(`id`),
  `created_at` integer NOT NULL,
  PRIMARY KEY (`prd_id`, `depends_on_prd_id`),
  CHECK (`prd_id` != `depends_on_prd_id`)
);
--> statement-breakpoint
CREATE INDEX `prd_depends_on_inverse_idx` ON `prd_depends_on` (`depends_on_prd_id`, `prd_id`);
