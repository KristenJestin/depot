#!/usr/bin/env bash
# PostToolUse hook: log a coder_progress event for the tool that just ran.
# Reads the JSON payload from stdin (claude-code convention).
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$DIR/lib.sh"

payload="$(cat || true)"
[[ -z "$payload" ]] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool_name="$(echo "$payload" | jq -r '.tool_name // empty')"
[[ -z "$tool_name" ]] && exit 0

depot::resolve_context || exit 0

case "$tool_name" in
  Edit|Write|MultiEdit|NotebookEdit)
    file_path="$(echo "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"
    [[ -z "$file_path" ]] && exit 0
    depot::log_progress "edit" "Edited $file_path" "$(jq -nc --arg file "$file_path" --arg tool "$tool_name" '{file: $file, tool: $tool}')"
    ;;
  Bash)
    cmd="$(echo "$payload" | jq -r '.tool_input.command // empty')"
    out="$(echo "$payload" | jq -r '.tool_output // empty')"
    code="$(echo "$payload" | jq -r '.exit_code // 0')"
    out_truncated="$(depot::truncate "$out" 500)"
    depot::log_progress "tool" "$(depot::truncate "$cmd" 200)" "$(jq -nc --arg cmd "$cmd" --arg out "$out_truncated" --argjson code "$code" '{tool: "Bash", command: $cmd, output: $out, exitCode: $code}')"
    ;;
  Read)
    file_path="$(echo "$payload" | jq -r '.tool_input.file_path // empty')"
    [[ -z "$file_path" ]] && exit 0
    depot::log_progress "note" "Read: $file_path" "$(jq -nc --arg file "$file_path" --arg tool "Read" '{file: $file, tool: $tool}')"
    ;;
  Grep)
    pattern="$(echo "$payload" | jq -r '.tool_input.pattern // empty')"
    path="$(echo "$payload" | jq -r '.tool_input.path // ""')"
    depot::log_progress "note" "Grep: $(depot::truncate "$pattern" 80)${path:+ in $path}" "$(jq -nc --arg tool "Grep" '{tool: $tool}')"
    ;;
  Glob)
    pattern="$(echo "$payload" | jq -r '.tool_input.pattern // empty')"
    depot::log_progress "note" "Glob: $(depot::truncate "$pattern" 80)" "$(jq -nc --arg tool "Glob" '{tool: $tool}')"
    ;;
  *)
    exit 0
    ;;
esac
