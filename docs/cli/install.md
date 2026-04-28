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

The generated files are static slash-command files, but they inject live context output directly into the prompt body using the agent tool's native shell-injection syntax.

They inject:

- `depot context prd`
- `depot context dev`

So the agent receives the rendered context itself, not an instruction telling it to run the command later.

OpenCode uses markdown command files with a `description` field.

Claude Code uses markdown command files with:

- `disable-model-invocation: true`
- `shell: powershell`

This keeps the command file static while still embedding fresh depot state at invocation time.
