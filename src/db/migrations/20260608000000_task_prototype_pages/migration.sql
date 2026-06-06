-- Page ↔ task link (PRD 0030 / issue 04).
--
-- A first-class M:N join — "this task realises these pages" — modeled exactly on
-- `task_user_stories`. A page can be linked to several tasks and a task to
-- several pages; the `(task_id, page_id)` pair is the primary key so a given
-- link exists at most once (idempotent). The cross-entity invariant (task and
-- page must belong to the same PRD revision) lives in the domain
-- (`task-pages.ts`), not the schema.
--
-- Additive: a plain CREATE TABLE + the reverse-direction index on `page_id` so
-- "the tasks of a page" is as cheap as "the pages of a task". Nothing is
-- dropped; on a fresh database there is nothing to back-fill.
CREATE TABLE `task_prototype_pages` (
  `task_id` text NOT NULL REFERENCES `tasks`(`id`),
  `page_id` text NOT NULL REFERENCES `prd_prototype_pages`(`id`),
  PRIMARY KEY(`task_id`, `page_id`)
);
--> statement-breakpoint
CREATE INDEX `task_prototype_pages_page_idx` ON `task_prototype_pages` (`page_id`);
