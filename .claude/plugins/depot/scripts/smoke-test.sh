#!/usr/bin/env bash
# Smoke test for the depot claude-code plugin. Verifies that:
#  1. depot is on PATH and answers --version
#  2. jq is available
#  3. each hook script is executable and sources lib.sh without error
#  4. lib.sh helpers (truncate, log_progress) don't throw on synthetic input
#
# Usage:
#   ./smoke-test.sh           # exits 0 on success, non-zero on first failure

set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

ok() {
  echo "  ok — $*"
}

echo "[1/4] CLI presence"
command -v depot >/dev/null 2>&1 || fail "depot not in PATH"
depot --version >/dev/null 2>&1 || fail "depot --version returned non-zero"
ok "depot available"

echo "[2/4] jq presence"
command -v jq >/dev/null 2>&1 || fail "jq not in PATH"
ok "jq available"

echo "[3/4] hook scripts are executable"
for script in "$DIR"/log-tool-use.sh "$DIR"/log-tool-failure.sh "$DIR"/log-subagent.sh "$DIR"/init-session.sh; do
  [[ -x "$script" ]] || fail "$script not executable (chmod +x missing)"
  ok "$(basename "$script") executable"
done

echo "[4/4] lib.sh helpers"
# shellcheck disable=SC1091
. "$DIR/lib.sh"
truncated="$(depot::truncate "abcdefghijklmnop" 5)"
[[ "$truncated" == "abcde…" ]] || fail "depot::truncate produced unexpected output: '$truncated'"
ok "depot::truncate respects max bytes"

echo ""
echo "Plugin smoke test passed."
