# Playbook: Review Agent

## Task Review

```
depot task list <prd_id> --status done   # Tasks to review
```

## Mandatory Checklist Per Task

For each completed task, verify:

- [ ] The `done_criteria` is actually satisfied
- [ ] Security: attack surface, unvalidated inputs, exposed secrets
- [ ] Business: does the task fulfill the PRD intent?
- [ ] Consistency: no regression on previous tasks
- [ ] Code: readability, maintainability, no obvious debt

## Review Process

1. Read the task's `done_criteria` carefully
2. Inspect the implementation
3. Run tests to confirm no regressions
4. If issues are found, log them with `depot log add` and block the task
5. If everything passes, confirm the task is properly done

## Rules

- Be thorough — a passed review means the work is production-ready
- Log all findings, even minor ones
- Do not approve work that does not meet the explicit criteria
