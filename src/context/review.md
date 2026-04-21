# Context: Review Agent

## Review Commands

```
depot context review                     # Load the live review context (active PRD, reviews, done tasks)
depot review start [prd_id]              # Start an autonomous review for the active or specified PRD
depot review start [prd_id] --mode assisted --feedback "..." # Start an assisted review with user feedback
depot review activate <review_id>        # Mark a pending review as in_progress
depot review findings <review_id> --findings '[...]' [--questions '[...]'] [--follow-up-tasks '[...]']
depot review decide <review_id> --decision approved|changes_requested|rejected [--note "..."]
depot review show <review_id>            # Show review details
depot review list [prd_id]              # List all reviews for a PRD
depot task list <prd_id>                 # Full task list for deeper inspection
```

## Review Modes

### Autonomous mode
The agent reviews all done tasks independently from the available context (PRD intent, scope, done criteria, implementation). No pre-framed user input is needed. The agent challenges the work on its own initiative and records structured findings.

### Assisted mode
The user provides free-text feedback as a starting point. The agent must:
1. Reformulate and clarify the user's feedback before acting on it
2. Ask questions to resolve ambiguities before producing findings
3. Treat the feedback as context to challenge, not as instructions to execute
4. Then proceed with autonomous challenge in addition to the framed feedback
The result is a single enriched review — not two separate reviews.

## Workflow

### Starting a review
1. Run `depot review start` to create a review object attached to the current PRD revision
2. Run `depot review activate <review_id>` to mark it as in_progress
3. Run `depot context review` to load the full context (PRD, tasks, existing reviews)

### Recording findings (agent)
Use `depot review findings <review_id>` with structured JSON arrays:
- `--findings '[{"title": "...", "severity": "critical|major|minor|info", "description": "..."}]'`
- `--questions '[{"question": "...", "context": "..."}]'` (for assisted mode)
- `--follow-up-tasks '[{"title": "...", "description": "...", "rationale": "..."}]'`

### Recording the decision (human only)
Only the human can close a review with a final decision:
```
depot review decide <review_id> --decision approved
depot review decide <review_id> --decision changes_requested --note "Rework task 3"
depot review decide <review_id> --decision rejected --note "PRD scope needs revision"
```

The agent must NEVER call `depot review decide` on its own. The decision is always human.

## Mandatory Checklist Per Task

For each completed task, verify:

- [ ] The `done_criteria` is actually satisfied
- [ ] Security: attack surface, unvalidated inputs, exposed secrets
- [ ] Business: does the task fulfill the PRD intent and scope?
- [ ] Consistency: no regression on previous tasks
- [ ] Code: readability, maintainability, no obvious debt

## Review Outcomes

After the agent records findings and the human decides, possible outcomes are:

| Decision | Meaning | Typical follow-up |
|---|---|---|
| `approved` | Work meets all criteria | Archive PRD or move forward |
| `changes_requested` | Work needs targeted fixes | Create new tasks via `depot task add` |
| `rejected` | PRD scope or implementation must be reconsidered | Amend PRD via `depot prd amend` |

Follow-up tasks suggested in `--follow-up-tasks` can be inspected with `depot review show` and added manually with `depot task add` after the human decision.

## Rules

- Be thorough — a passed review means the work is production-ready
- Record all findings, even minor ones, as structured JSON via `depot review findings`
- Do not call `depot review decide` — the decision is always human
- In assisted mode, never execute user feedback as direct dev instructions
- A review is always attached to the PRD revision that was active when it was created
- Multiple reviews can exist for the same PRD across different revisions
