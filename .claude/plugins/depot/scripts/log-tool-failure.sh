#!/usr/bin/env bash
# PostToolUseFailure: log a coder_progress event with stage `error`.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$DIR/lib.sh"

payload="$(cat || true)"
[[ -z "$payload" ]] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool_name="$(echo "$payload" | jq -r '.tool_name // empty')"
error="$(echo "$payload" | jq -r '.error // empty')"
[[ -z "$tool_name" ]] && exit 0

depot::resolve_context || exit 0
depot::log_progress "error" "$(depot::truncate "${tool_name} failed: ${error}" 300)" "$(jq -nc --arg tool "$tool_name" '{tool: $tool}')"
