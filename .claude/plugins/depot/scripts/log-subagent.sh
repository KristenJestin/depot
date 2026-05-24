#!/usr/bin/env bash
# SubagentStart / SubagentStop hook: log a coder_progress note.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$DIR/lib.sh"

phase="${1:-start}"
payload="$(cat || true)"
command -v jq >/dev/null 2>&1 || exit 0

agent_name="$(echo "$payload" | jq -r '.subagent_name // empty')"
depot::resolve_context || exit 0
if [[ "$phase" == "start" ]]; then
  depot::log_progress "note" "Subagent started: ${agent_name:-unknown}"
else
  depot::log_progress "note" "Subagent stopped: ${agent_name:-unknown}"
fi
