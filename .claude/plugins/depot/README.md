# depot — claude-code plugin

Live activity hooks for claude-code. Surfaces what the agent is doing into depot's activity log so the web UI shows real-time progress without the coder having to log every step manually.

## What it captures

| Hook                     | Tool / event                                 | Result                                                                                  |
| ------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `SessionStart`           | session opens                                | logs a `note`, prints any pending actions for the project                               |
| `PostToolUse`            | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | logs `coder_progress` stage `edit` with `file`                                          |
| `PostToolUse`            | `Bash`                                       | logs `coder_progress` stage `tool` with `command`, `output` (500 chars), and `exitCode` |
| `PostToolUse`            | `Read`, `Grep`, `Glob`                       | logs `coder_progress` stage `note` (path / pattern only)                                |
| `PostToolUseFailure`     | any tool failure                             | logs `coder_progress` stage `error` with the tool name and truncated error message      |
| `SubagentStart` / `Stop` | subagent lifecycle                           | logs `coder_progress` stage `note`                                                      |

Every event carries `source: "plugin"` so the web UI can render a distinct "plugin" badge in the timeline.

## Install

```
depot install --claude-code-plugin                 # ~/.claude/plugins/depot/ (default)
depot install --claude-code-plugin --plugin-scope project   # <cwd>/.claude/plugins/depot/
```

Restart your claude-code session after install. To remove, delete the directory.

## Kill-switch

```
export DEPOT_PLUGIN_DISABLED=1
```

Set in your shell rc to disable every hook silently. Useful when you want a quiet session.

## Opt-in prompt logging

```
export DEPOT_PLUGIN_LOG_PROMPTS=1
```

By default the plugin does not capture user prompts (privacy + verbose). Set this var to opt in to a `note` event per user message (truncated to 100 chars).

## Troubleshooting

- **`depot: command not found`** in the hook script → ensure `depot` is on `PATH` in the same shell that spawns claude-code (test with `which depot`).
- **`jq: command not found`** → install jq (`brew install jq`, `apt install jq`). The plugin needs it to parse the hook payloads.
- **Events not appearing** → run `./scripts/smoke-test.sh` from the plugin directory. It checks PATH, jq, executable bits, and lib.sh helpers.
- **Best-effort caveat** → the plugin runs every hook in the background and never blocks the agent. On very fast tool calls (a microsecond Bash), the log call may not finish before the next tool fires. This is intentional. If a few events go missing, that's the trade-off.

## Smoke test

```
~/.claude/plugins/depot/scripts/smoke-test.sh
```

Verifies depot + jq are on PATH, every hook script has `+x`, and the `lib.sh` helpers behave as expected. Exits non-zero on the first failure.
