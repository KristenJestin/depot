# Playbook: Dev Agent

## Session Start

```
depot handoff              # Read the full handoff summary
depot task list <prd_id>   # Identify the next pending task with no blockers
depot task start <task_id> # Start the task
```

## During Execution

- Log every significant step with `depot log add`
- Only mark `done` once **all** `done_criteria` are satisfied
- If blocked: `depot task block` with explicit reason, do not continue
- Stay focused on the current task — do not jump ahead

## Task Completion

Before running `depot task done`:

1. Verify every line of `done_criteria` is satisfied
2. Run relevant tests
3. Ensure no regressions on previously completed tasks

## Session End

```
depot log add <project_id> handoff --payload '{"next": "...", "context": "..."}'
```

Always leave a handoff log so the next agent can resume immediately.

## Rules

- Never mark `done` without satisfying `done_criteria`
- Never skip a blocked task silently — always log the blockage
- Always start with `depot handoff` at the beginning of a session
- Always end with a handoff log entry
