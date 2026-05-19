# Install Command

`depot install` writes integration files for supported agent tools.

## Usage

```bash
depot install [--opencode] [--claude-code] [--codex] [--all]
```

## Targets

- OpenCode: `~/.config/opencode/commands/`
- Claude Code: `~/.claude/commands/`
- Codex: `~/.agents/skills/`

Without an explicit flag, `depot install` scans the canonical directories and writes files to whichever ones already exist. If none exist, the command errors and tells you to use an explicit flag.

With `--opencode`, `--claude-code`, `--codex`, or `--all`, depot creates the missing canonical directory before writing files.

## Files Written

For each selected target, depot writes:

- `depot-prd.md`
- `depot-dev.md`

For Codex, depot writes skills instead:

- `depot-prd/SKILL.md`
- `depot-prd/agents/openai.yaml`
- `depot-dev/SKILL.md`
- `depot-dev/agents/openai.yaml`

Existing files are overwritten in place.

## Runtime Behavior

OpenCode and Claude Code receive static slash-command files that inject live context output directly into the prompt body using the agent tool's native shell-injection syntax.

They inject:

- `depot context prd`
- `depot context dev $ARGUMENTS`

For `depot-dev`, the argument is optional. Running `/depot-dev` loads the
current workspace dev context; running `/depot-dev <prd-id>` forwards the ID to
`depot context dev <prd-id>`.

So the agent receives the rendered context itself, not an instruction telling it to run the command later.

OpenCode uses markdown command files with a `description` field.

Claude Code uses markdown command files with:

- `disable-model-invocation: true`
- `shell: powershell`

Codex custom prompts are deprecated by OpenAI. Depot installs Codex skills instead, following the current Codex guidance that reusable prompts should be packaged as skills. The generated skills disable implicit invocation, so Codex should not select them automatically. Invoke them explicitly with `$depot-prd` or `$depot-dev`, or through the Codex skill/slash-command UI. When invoked, the skill instructs Codex to run `depot context prd` or `depot context dev` immediately and use that rendered output as the working context. `$depot-dev <prd-id>` instructs Codex to run `depot context dev <prd-id>`.

This keeps generated integrations static while still loading fresh depot state at invocation time.
