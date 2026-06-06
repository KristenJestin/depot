#!/usr/bin/env bash
#
# Install depot globally from the current local branch, tagged `-dev.<sha>`.
#
# Safety:
#   - Refuses to run if the working tree has uncommitted changes (--force to skip).
#   - Warns (not blocks) if the current branch is not `dev`.
#   - Backs up ~/.depot/depot.db before installing so a schema migration can be
#     rolled back by restoring the most recent backup. Set --no-backup to skip,
#     or DEPOT_PROD_DB to override the path.
#   - Leaves package.json bumped to `X.Y.0-dev.<sha>` so the linked install
#     keeps reporting the dev label until the user reverts it.
#
# Usage:
#   bun run install:dev            # standard flow
#   bun run install:dev -- --force # ignore dirty tree
#   bun run install:dev -- --no-backup
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# When this script is launched via 'bun run install:dev', bun puts
# node_modules/.bin first on PATH so 'vp' resolves to the build-only
# vite-plus *package* — which has 'pack' / 'build' but no 'add'. We need
# the full vite-plus *CLI* installed under ~/.vite-plus/. Pin its bin
# directory ahead of node_modules/.bin for the rest of this script.
if [[ -x "$HOME/.vite-plus/bin/vp" ]]; then
  PATH="$HOME/.vite-plus/bin:$PATH"
fi

# ─── flags ────────────────────────────────────────────────────────────────────
FORCE=0
DO_BACKUP=1
while (($#)); do
  case "$1" in
    --force) FORCE=1 ;;
    --no-backup) DO_BACKUP=0 ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

PROD_DB="${DEPOT_PROD_DB:-$HOME/.depot/depot.db}"

# ─── pre-flight ───────────────────────────────────────────────────────────────
BRANCH="$(git branch --show-current)"
SHA="$(git rev-parse --short HEAD)"
DIRTY="$(git status --porcelain)"

# An earlier install:dev run leaves package.json on a `X.Y.0-dev.<sha>`
# label by design (see below) so this single file is allowed to be dirty
# on re-runs — anything else still blocks unless --force is passed.
DIRTY_NON_VERSION="$(printf '%s\n' "$DIRTY" | grep -v '^.. package\.json$' || true)"
if [[ -n "$DIRTY_NON_VERSION" && "$FORCE" != 1 ]]; then
  echo "✗ Working tree is dirty. Commit / stash first, or rerun with --force." >&2
  printf '%s\n' "$DIRTY_NON_VERSION" >&2
  exit 1
fi

if [[ "$BRANCH" != "dev" ]]; then
  echo "⚠  Current branch is '$BRANCH' (expected 'dev'). Continuing in 2s — Ctrl+C to abort."
  sleep 2
fi

# ─── backup prod DB ───────────────────────────────────────────────────────────
if [[ "$DO_BACKUP" == 1 && -f "$PROD_DB" ]]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  BACKUP="${PROD_DB}.backup-install-dev-${TS}"
  cp -a "$PROD_DB" "$BACKUP"
  for ext in -wal -shm; do
    [[ -f "${PROD_DB}${ext}" ]] && cp -a "${PROD_DB}${ext}" "${BACKUP}${ext}" || true
  done
  echo "✓ Backed up prod DB → $BACKUP"
elif [[ "$DO_BACKUP" != 1 ]]; then
  echo "⊘ Skipped DB backup (--no-backup)"
else
  echo "(no prod DB at $PROD_DB — skipping backup)"
fi

# ─── compute + bump version ──────────────────────────────────────────────────
# `vp pack` inlines package.json `version` into dist/index.mjs, so the bump
# has to happen BEFORE the build for `depot --version` to print the dev
# label. We deliberately do NOT restore package.json afterwards either —
# `vp add -g .` symlinks node_modules/@netsirk/depot to this repo, so the
# linked binary keeps reading package.json at runtime for any future
# rebuild. The user reverts manually with `git checkout package.json`.
ORIG_VERSION="$(node -p "require('./package.json').version")"
NAME="$(node -p "require('./package.json').name")"

# Bump the minor and reset patch to 0 so the dev label sorts above the last
# published release. If package.json is already on a dev label from a previous
# run, keep that base version instead of inflating 2.8-dev -> 2.9-dev -> ...
DEV_VERSION="$(node -e "
  const current = '${ORIG_VERSION}';
  const core = current.replace(/-.*\$/, '');
  const v = core.split('.').map(Number);
  if (!current.includes('-dev.')) {
    v[1] += 1;
    v[2] = 0;
  }
  console.log(v.join('.') + '-dev.${SHA}');
")"

node -e "
  const fs=require('fs');
  const p='./package.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.version='${DEV_VERSION}';
  fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
"
# Fail-safe: if anything below errors out, leave package.json bumped so
# the user knows the run was interrupted and can git-checkout it.
trap 'echo "(package.json left at ${DEV_VERSION}; git checkout package.json to revert)" >&2' ERR

# ─── build ────────────────────────────────────────────────────────────────────
echo "→ Building CLI + web at ${DEV_VERSION}…"
bun run build       >/dev/null
bun run build:web   >/dev/null

echo "→ vp add -g . (version ${DEV_VERSION})"
vp add -g .

# ─── verify ───────────────────────────────────────────────────────────────────
WHICH="$(command -v depot || true)"
INSTALLED="$(depot --version 2>/dev/null | tail -n1 || echo '?')"

cat <<EOF
✓ Installed ${NAME}@${DEV_VERSION}
  binary : ${WHICH}
  version: ${INSTALLED}
  branch : ${BRANCH}
  sha    : ${SHA}

The global install is a symlink to this repo, so any rebuild here is
picked up instantly. package.json was bumped to ${DEV_VERSION} and is
left dirty on purpose so 'depot --version' reflects the dev label.

To go back to the published version:
  git checkout package.json
  vp add -g @netsirk/depot

DB backups in ~/.depot/ — restore by copying the most recent
.backup-install-dev-* over depot.db (with matching -wal / -shm sidecars).
EOF
