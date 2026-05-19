#!/usr/bin/env bash
# SessionStart hook: log the start of a claude-code session.
#
# === pending actions (PRD 08) ===
# When PRD 08 lands, extend this block to print pending actions for the
# current project. Today the script only logs the session start.

set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$DIR/lib.sh"

depot::resolve_context || exit 0
depot::log_progress "note" "Session started"

# === pending actions (PRD 08) ===
if command -v depot >/dev/null 2>&1; then
  OUTPUT="$(depot --json pending list --status pending 2>/dev/null || echo '{}')"
  COUNT="$(echo "$OUTPUT" | jq '.items | length // 0' 2>/dev/null || echo 0)"
  if [[ "${COUNT:-0}" -gt 0 ]]; then
    echo "📥 depot has $COUNT pending action(s) for this project:"
    echo "$OUTPUT" | jq -r '.items[] | "  [\(.id)] \(.humanReadableLabel) → \(.slashCommand)"'
    echo ""
    echo "Run \`depot pending show <id>\` for details, or invoke the slash command directly."
  fi
fi
