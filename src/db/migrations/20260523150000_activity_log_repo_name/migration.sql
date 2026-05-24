-- Attribution `repo` dans le log d'activité (PRD 0006 / issue 02).
--
-- `activity_log` ne portait jusqu'ici aucune dimension repo : impossible de
-- filtrer/afficher l'activité par sous-repo d'un projet multi-repo. On ajoute
-- une colonne `repo_name` **nullable**, dénormalisée :
--
-- - `NULL` = non-attribuable (mono-repo, ligne historique antérieure au
--   déploiement, ou modif au niveau projet hors d'un `project_repo` précis).
-- - non-null = attribution explicite au `project_repo.name`.
--
-- Stockée comme nom (et pas FK rigide) pour survivre à un `removeRepo`.
-- Pas de backfill : les lignes existantes restent à `NULL` ; seules les
-- nouvelles opérations peupleront la colonne. Un index `(project_id,
-- repo_name)` soutient le filtre `?repo=` côté API.
ALTER TABLE `activity_log` ADD COLUMN `repo_name` text;
--> statement-breakpoint
CREATE INDEX `activity_log_repo_name_idx` ON `activity_log` (`project_id`, `repo_name`);
