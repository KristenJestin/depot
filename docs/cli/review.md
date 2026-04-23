# Review Commands

`depot review` manages the review loop for completed work in a PRD.

Reviews are containers of tasks. Findings are tasks with a `review_id` and an optional `severity`.

## Status model

- `draft` — created, tasks not yet added (protection against crash during analysis)
- `in_progress` — tasks created, coder working on them
- `done` — all tasks completed

## Types

- `agent` — created by the auditor sub-agent after automatic review
- `human` — created by the orchestrator from human feedback

---

## `depot review start`

Create a new review for a PRD.

### Usage

```bash
depot review start <prd-id> --type <human|agent>
```

Creates the review in `draft` status. The `--type` flag is required.

### Example

```bash
depot review start <prd-id> --type agent
```

---

## `depot review task add`

Add a task (finding) to a review.

### Usage

```bash
depot review task add <review-id> \
  --title <str> \
  --description <str> \
  --done-criteria <str> \
  [--severity <critical|major|minor|info>]
```

### Severity guide

- `critical` — blocks correctness or safety
- `major` — significant quality or behavioral issue
- `minor` — small improvement or cleanup
- `info` — observation, no action required

---

## `depot review done`

Mark a review as done.

### Usage

```bash
depot review done <review-id>
```

Moves the review from `in_progress` to `done`.

---

## `depot review show`

Show full details for a review.

### Usage

```bash
depot review show <review-id>
```

### Output

Prints aligned key-value fields: ID, PRD, Type, Status, User Feedback, Created, Done.

Also prints the list of tasks associated with this review (id, title, severity, status).

---

## `depot review list`

List reviews for a PRD.

### Usage

```bash
depot review list <prd-id>
```

### Output

Each line includes the review ID, type, status, and PRD ID.
