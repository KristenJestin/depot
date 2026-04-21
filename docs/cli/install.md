# Install Command

`depot install` writes slash-command files for supported agent tools.

## Usage

```bash
depot install [--opencode] [--claude-code] [--all]
```

## Targets

- OpenCode: `~/.config/opencode/commands/`
- Claude Code: `~/.claude/commands/`

With no explicit flag, `depot install` scans those canonical directories and installs into whichever ones already exist. If neither exists, the command errors and tells you to use an explicit flag.

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

That means the agent tool always loads fresh context from the `depot` binary on the `PATH` at the time the command is invoked.

On Windows, the generated shell is `powershell`. On all other platforms, it is `bash`.

The OpenCode command format uses a YAML frontmatter with `description` only. The Claude Code format adds `disable-model-invocation: true` and a `shell` field.
