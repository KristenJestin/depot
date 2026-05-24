#!/usr/bin/env bash
# depot plugin — shared helpers. Every hook script sources this file.

# Kill-switch: any non-empty value disables every hook silently.
if [[ -n "${DEPOT_PLUGIN_DISABLED:-}" ]]; then
  exit 0
fi

# Truncate a string to N bytes (default 500). Best-effort, byte-safe.
depot::truncate() {
  local input="${1:-}"
  local max="${2:-500}"
  if [[ "${#input}" -le "$max" ]]; then
    printf '%s' "$input"
  else
    printf '%s…' "${input:0:$max}"
  fi
}

# Resolve the workspace+PRD context for the current cwd. Sets DEPOT_WS_PATH,
# DEPOT_PROJECT_ID, DEPOT_PRD_ID (may be empty if no active PRD).
depot::resolve_context() {
  if ! command -v depot >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    return 1
  fi
  local prdJson
  prdJson="$(depot --json prd list --status in_progress 2>/dev/null || true)"
  if [[ -z "$prdJson" ]]; then return 1; fi
  DEPOT_PRD_ID="$(echo "$prdJson" | jq -r '.items[0].id // empty')"
  DEPOT_PROJECT_ID="$(echo "$prdJson" | jq -r '.items[0].projectId // empty')"
  export DEPOT_PRD_ID DEPOT_PROJECT_ID
}

# Best-effort log of a coder_progress event. Never blocks the agent.
depot::log_progress() {
  local stage="$1"
  local message="$2"
  shift 2
  local extra="$*"
  local payload
  payload="$(jq -nc \
    --arg stage "$stage" \
    --arg message "$message" \
    --arg source "plugin" \
    '{stage: $stage, message: $message, source: $source}')"
  if [[ -n "$extra" ]]; then
    payload="$(echo "$payload" | jq -c ". + $extra")"
  fi
  (depot log add --type coder_progress --payload "$payload" >/dev/null 2>&1 || true) &
  disown 2>/dev/null || true
}
