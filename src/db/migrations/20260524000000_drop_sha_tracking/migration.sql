-- Retrait diff/review/SHA — phase 3 (PRD 0009 / issue 03).
--
-- Drop des colonnes SHA et `worktree_path` sur `prd_revisions`, drop des
-- tables `prd_merge` et `prd_phase_snapshots`. Destructif assumé : aucun
-- consommateur restant dans la base de code (PRD 0009 / issues 01–02 ont
-- déjà retiré le web, le domaine, le CLI et les helpers).
--
-- SQLite ≥ 3.35 supporte `ALTER TABLE … DROP COLUMN` ; les colonnes visées
-- ne portent ni FK ni index, donc un drop direct fonctionne. Les deux tables
-- supprimées n'ont que des FK sortantes ; rien ne pointe vers elles, donc
-- `DROP TABLE` les retire proprement avec leurs index.
DROP TABLE `prd_merge`;
--> statement-breakpoint
DROP TABLE `prd_phase_snapshots`;
--> statement-breakpoint
ALTER TABLE `prd_revisions` DROP COLUMN `activated_at_sha`;
--> statement-breakpoint
ALTER TABLE `prd_revisions` DROP COLUMN `done_at_sha`;
--> statement-breakpoint
ALTER TABLE `prd_revisions` DROP COLUMN `merged_at_sha`;
--> statement-breakpoint
ALTER TABLE `prd_revisions` DROP COLUMN `worktree_path`;
