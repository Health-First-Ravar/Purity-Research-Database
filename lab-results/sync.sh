#!/usr/bin/env bash
# Daily sync of Brian's Lab Testing tracker into the Research Hub.
#
#   bash lab-results/sync.sh <page.html> <dump-dir>
#
# <page.html> is his tracker page saved by an Artifact read; <dump-dir> holds his
# artifact database collections dumped with ArtifactData out_dir (see
# build-snapshot.mjs). The snapshot is rebuilt on the lab-snapshots branch and
# pushed only when the data changed; the push runs the Lab Sync workflow, which
# imports it into Supabase. Nothing here writes back to Brian's tracker.
set -euo pipefail

PAGE=$(realpath "${1:?usage: sync.sh <page.html> <dump-dir>}")
DUMP=$(realpath "${2:?usage: sync.sh <page.html> <dump-dir>}")
cd "$(git rev-parse --show-toplevel)"

BRANCH=lab-snapshots
GIT_ID=(-c user.name="Purity Lab Sync" -c user.email="lab-sync@users.noreply.github.com")
BASE=${LAB_SYNC_BASE:-}
if [ -z "$BASE" ]; then
  # Until the overhaul is merged into main, the importer lives on the overhaul branch.
  if git ls-remote --exit-code --heads origin overhaul >/dev/null 2>&1; then BASE=overhaul; else BASE=main; fi
fi

git fetch -q origin "$BASE"
FORCE=0
if git fetch -q origin "$BRANCH" 2>/dev/null; then
  git checkout -q -B "$BRANCH" "origin/$BRANCH"
  # Keep the branch's code current with the base; if that cannot merge cleanly
  # (for example the base was rebased), start the branch over from the base.
  if ! git "${GIT_ID[@]}" merge -q --no-edit "origin/$BASE" >/dev/null 2>&1; then
    git merge --abort 2>/dev/null || true
    git checkout -q -B "$BRANCH" "origin/$BASE"
    FORCE=1
  fi
else
  git checkout -q -B "$BRANCH" "origin/$BASE"
fi

node lab-results/build-snapshot.mjs --page "$PAGE" --db "$DUMP" \
  --out lab-results/snapshot.json --previous lab-results/snapshot.json

if git diff --quiet -- lab-results/snapshot.json; then
  echo "RESULT: no change in Brian's tracker since the last snapshot; nothing pushed (base: $BASE)."
  exit 0
fi

ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("lab-results/snapshot.json","utf8")).snapshot_id)')
git add lab-results/snapshot.json
git "${GIT_ID[@]}" commit -q -m "Lab snapshot $ID"
if [ "$FORCE" = 1 ]; then git push -q --force origin "$BRANCH"; else git push -q origin "$BRANCH"; fi
echo "RESULT: pushed $ID to $BRANCH at $(git rev-parse HEAD) (base: $BASE)."
