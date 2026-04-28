# Review Commands

`depot review` manages the review loop around PRD work.

Reviews are containers for finding tasks. Findings are stored as tasks with a `reviewId` and an optional severity.

## Status Model

- `draft`: review created, findings not fully recorded yet
- `in_progress`: review draft validated and follow-up work is active
- `done`: the review is closed

## Types

- `agent`: review created by the auditor flow
- `human`: review created from human feedback

## `depot review start`

Create a new review for a PRD.

### Usage

```bash
depot review start <prd-id> --type <human|agent>
```

Creates the review in `draft` status.

## `depot review begin`

Validate a review draft and move it to `in_progress`.

### Usage

```bash
depot review begin <review-id>
```

Use this when the review is fully specified and ready to drive the next coder pass.

## `depot review task add`

Add a task to a review.

### Usage

```bash
depot review task add <review-id> --title <str> --description <str> --doneCriteria <str> [--severity <critical|major|minor|info>]
```

### Notes

- adding tasks no longer auto-validates the review
- review tasks are stored in the main `tasks` table with `reviewId` set
- the default effort for review tasks is `s` when not otherwise specified in code

### Severity guide

- `critical`: correctness or safety issue
- `major`: significant behavioral or quality issue
- `minor`: smaller defect or cleanup
- `info`: observation with low urgency

## `depot review done`

Mark a review as done.

### Usage

```bash
depot review done <review-id>
```

The transition table allows:

- `draft -> done`
- `in_progress -> done`

An empty draft review can be closed directly. A draft review that already contains findings must be validated first with `depot review begin` before it can be closed.

## `depot review show`

Show full details for a review.

### Usage

```bash
depot review show <review-id>
```

Prints aligned fields for ID, PRD, Type, Status, User Feedback, Created, and Done.

It also prints the tasks associated with the review.

## `depot review list`

List reviews for a PRD.

### Usage

```bash
depot review list <prd-id>
```

Each line includes the review ID, type, status, and PRD ID.
