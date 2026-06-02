-- Backfill `prd_revisions.current_phase` on PRDs that have phased tasks but
-- whose `current_phase` is still NULL (PRD 0017 / T4c).
--
-- Pre-T2 (auto-seed in `createTask`) and pre-T4a (auto-derive in
-- `activatePrd`), an agent who created a multi-phase PRD via
-- `depot task add --phase N` ended up with phased tasks but
-- `current_phase = NULL`, which made `depot prd phase-advance` reject the
-- PRD with "no phases defined". This migration retro-fits the value for
-- every existing PRD in that state, using the same rule as `activatePrd`:
-- prefer the first non-done phase (the one the user is actually working on)
-- and fall back to the max phase when every task is already done.
--
-- Idempotent: the outer `WHERE current_phase IS NULL` guard means re-running
-- this migration on a healthy DB is a no-op. SQLite's `MIN`/`MAX` over an
-- empty filtered set returns NULL, so the COALESCE collapses cleanly when a
-- particular branch produces no row.
UPDATE prd_revisions
SET current_phase = (
  SELECT COALESCE(
    (SELECT MIN(t.phase_number) FROM tasks t
     WHERE t.prd_revision_id = prd_revisions.id
       AND t.phase_number IS NOT NULL
       AND t.status != 'done'),
    (SELECT MAX(t.phase_number) FROM tasks t
     WHERE t.prd_revision_id = prd_revisions.id
       AND t.phase_number IS NOT NULL)
  )
)
WHERE current_phase IS NULL
  AND id IN (
    SELECT DISTINCT prd_revision_id FROM tasks WHERE phase_number IS NOT NULL
  );
