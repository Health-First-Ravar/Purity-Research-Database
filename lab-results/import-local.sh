#!/usr/bin/env bash
# Import a lab snapshot into Supabase from this machine, without tsx.
# Used by the Mac-bound scheduled task: its Linux VM can't run the macOS tsx
# binary in node_modules, so the importer runs under node's type stripping.
#
#   bash lab-results/import-local.sh [snapshot.json] [--dry]
#
# Default snapshot: lab-results/latest/snapshot.json. Env from dashboard/app/.env.local.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP="$ROOT/dashboard/app"
SNAP="$ROOT/lab-results/latest/snapshot.json"
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then SNAP=$(cd "$(dirname "$1")" && pwd)/$(basename "$1"); shift; fi
[ -f "$SNAP" ] || { echo "[import-local] no snapshot at $SNAP" >&2; exit 1; }

# Work outside the repo; a node_modules link lets the copy resolve packages.
RUN=$(mktemp -d)
trap 'rm -rf "$RUN"' EXIT
ln -s "$APP/node_modules" "$RUN/node_modules"
cp "$APP/lib/lab-status.ts" "$APP/lib/lab-snapshot.ts" "$RUN/"
sed -e "s#'../lib/lab-status'#'./lab-status.ts'#" -e "s#'../lib/lab-snapshot'#'./lab-snapshot.ts'#" \
  "$APP/scripts/import-lab-results.ts" > "$RUN/import.mts"

cd "$APP"
node --env-file=.env.local --experimental-strip-types --no-warnings "$RUN/import.mts" --snapshot "$SNAP" "$@"
