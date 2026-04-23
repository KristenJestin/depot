# Review Commands

`depot review` manages the structured review loop for completed work in a PRD.

Reviews are created by the review agent and decided by the human. Only the human can call `depot review decide`.

## Status model

- `pending` — created, not yet activated
- `in_progress` — agent is working on it
- `completed` — human has recorded a decision

## Modes

- `autonomous` — agent reviews all done tasks independently
- `assisted` — user provides free-text feedback; agent reformulates, questions, then produces findings

---

## `depot review start`

Start a review for the active or specified PRD.

### Usage

```bash
depot review start [prd-id] [--mode <autonomous|assisted>] [--feedback <text>]
```

### Notes

- If no `prd-id` is provided, the command resolves the active (`in_progress`) PRD for the current workspace.
- `--mode` defaults to `autonomous`.
- `--feedback` is required when `--mode assisted`.
- After creation, the review is in `pending` status. Run `depot review activate` for the agent to begin work.

### Example

```bash
# Autonomous review of the active PRD
depot review start

# Assisted review with user feedback
depot review start --mode assisted --feedback "Check that validation handles empty inputs"
```

---

## `depot review activate`

Mark a pending review as `in_progress` so the agent can begin work.

### Usage

```bash
depot review activate <review-id>
```

---

## `depot review show`

Show full details for a review.

### Usage

```bash
depot review show <review-id>
```

### Output

Prints aligned key-value fields: ID, PRD, Revision, Status, Mode, Decision, Decision Note, User Feedback, Created, Completed.

Also prints structured findings and suggested follow-up tasks if any are recorded.

---

## `depot review list`

List reviews for the active or specified PRD.

### Usage

```bash
depot review list [prd-id]
```

If no `prd-id` is provided, the active PRD for the current workspace is used.

### Output

Each line includes the review ID, status, mode, decision (if any), and PRD revision.

---

## `depot review findings`

Record structured findings for a review (agent-facing).

### Usage

```bash
depot review findings <review-id> \
  --findings '<json-array>' \
  [--questions '<json-array>'] \
  [--follow-up-tasks '<json-array>']
```

### Argument format

- `--findings` — JSON array of `{ title, severity, description }` objects. `severity` should be one of `critical`, `major`, `minor`, or `info`.
- `--questions` — JSON array of `{ question, context }` objects. Used in assisted mode.
- `--follow-up-tasks` — JSON array of `{ title, description, rationale }` objects.

### Example

```bash
depot review findings <review-id> \
  --findings '[{"title":"Missing input validation","severity":"major","description":"The --desc flag accepts empty strings"}]' \
  --follow-up-tasks '[{"title":"Add --desc validation","description":"Reject empty desc on task add","rationale":"Prevents silent data corruption"}]'
```

### Notes

- Can be called multiple times before the review is completed; each call overwrites the previous findings.
- Errors if the review is already `completed`.

---

## `depot review decide`

Record the human decision for a completed review. This command is for humans only — the agent must never call it autonomously.

### Usage

```bash
depot review decide <review-id> --decision <approved|changes_requested|rejected> [--note <text>]
```

### Decisions

| Decision            | Meaning                                          | Typical follow-up                     |
| ------------------- | ------------------------------------------------ | ------------------------------------- |
| `approved`          | Work meets all criteria                          | Archive PRD or move forward           |
| `changes_requested` | Work needs targeted fixes                        | Create new tasks via `depot task add` |
| `rejected`          | PRD scope or implementation must be reconsidered | Amend PRD via `depot prd amend`       |

### Notes

- Moves the review status to `completed`.
- The optional `--note` explains the decision context.
- Errors if the review is already `completed`.
