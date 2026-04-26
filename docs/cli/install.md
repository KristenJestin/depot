# Install Command

`depot install` writes slash-command files for supported agent tools.

## Usage

```bash
depot install [--opencode] [--claude-code] [--all]
```

## Targets

- OpenCode: `~/.config/opencode/commands/`
- Claude Code: `~/.claude/commands/`

Without an explicit flag, `depot install` scans the canonical directories and writes files to whichever ones already exist. If neither exists, the command errors and tells you to use an explicit flag.

With `--opencode`, `--claude-code`, or `--all`, depot creates the missing canonical directory before writing files.

## Files Written

For each selected target, depot writes:

- `depot-prd.md`
- `depot-dev.md`

Existing files are overwritten in place.

## Runtime Behavior

The generated files do not embed static snapshots. They use native shell injection to call:

- `depot context prd`
- `depot context dev`

That means the agent tool always loads fresh context from the `depot` binary on the `PATH` at invocation time.

On Windows, the generated shell is `powershell`. On other platforms, it is `bash`.

The OpenCode format uses frontmatter with a `description` field. The Claude Code format adds `disable-model-invocation: true` and a `shell` field.
