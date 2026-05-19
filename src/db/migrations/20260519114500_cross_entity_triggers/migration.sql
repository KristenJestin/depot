-- Cross-entity consistency triggers.
--
-- Enforces at the database layer the invariant that a PRD revision's
-- `workspace_id` must point to a workspace from the same project as the
-- revision's `project_id`. Catches drift if any code path (legacy callers,
-- direct SQL, future code) tries to corrupt the link.
--
-- NB: If the migration aborts because of pre-existing inconsistencies,
-- run `depot project diagnose` to list them and fix manually before
-- re-running.

CREATE TRIGGER IF NOT EXISTS prd_revisions_workspace_consistency_insert
BEFORE INSERT ON prd_revisions
FOR EACH ROW
WHEN NEW.workspace_id IS NOT NULL
  AND NEW.project_id != (SELECT project_id FROM workspaces WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(FAIL, 'prd_revisions.workspace_id must belong to the same project as prd_revisions.project_id');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS prd_revisions_workspace_consistency_update
BEFORE UPDATE OF workspace_id, project_id ON prd_revisions
FOR EACH ROW
WHEN NEW.workspace_id IS NOT NULL
  AND NEW.project_id != (SELECT project_id FROM workspaces WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(FAIL, 'prd_revisions.workspace_id must belong to the same project as prd_revisions.project_id');
END;
