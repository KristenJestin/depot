# Context: Dev Agent

## Session Start

```
depot context dev          # Load the live execution summary for this workspace
depot task show <task_id>  # Read the full task spec before starting or resuming
depot task start <task_id> # Start the selected task after reading its full details
```

## During Execution

- Log every significant step with `depot log add`
- Re-run `depot task show <task_id>` before resuming after an interruption
- Only mark `done` once **all** `done_criteria` are satisfied
- If blocked: `depot task block` with explicit reason, do not continue
- Stay focused on the current task - do not jump ahead
- Do not rely on `depot context dev` alone as the complete task spec

## Task Completion

Before running `depot task done`:

1. Verify every line of `done_criteria` is satisfied
2. Run relevant tests
3. Ensure no regressions on previously completed tasks

## Rules

- Never mark `done` without satisfying `done_criteria`
- Never skip a blocked task silently - always log the blockage
- Always read the task again with `depot task show <task_id>` before starting or resuming it
