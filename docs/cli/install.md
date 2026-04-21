# Install Command

`depot install` writes slash-command files for supported agent tools.

## Usage

```bash
depot install [--opencode] [--claude-code] [--all]
```

## Targets

- OpenCode: `~/.config/opencode/commands/`
- Claude Code: `~/.claude/commands/`

With no explicit flag, `depot install` installs into whichever of those canonical directories already exist.

With `--opencode`, `--claude-code`, or `--all`, the command creates the missing canonical directory before writing files.

## Files written

The command writes these files for each selected target:

- `depot-prd.md`
- `depot-dev.md`
- `depot-review.md`

Existing files are replaced in place without backup.

## Runtime behavior

The generated files do not embed static snapshots. They use native shell injection to call:

- `depot context prd`
- `depot context dev`
- `depot context review`

That means the agent tool always loads fresh context from the installed `depot` binary on the `PATH`.
