#!/usr/bin/env bash
# Initialize git in the repo root, copy the proper .gitignore, make first commit.
# Idempotent: safe to re-run.
# Run from repo root: bash prompts/deploy/scripts/01-init-git.sh

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

echo ""
echo "Initialize git"
echo "  repo root: $ROOT"
echo ""

# ---- 1. .gitignore ----
if [[ -f .gitignore ]]; then
  echo -e "  ${YELLOW}!${NC} .gitignore exists; will not overwrite. Manual review recommended."
else
  cp prompts/deploy/.gitignore .gitignore
  echo -e "  ${GREEN}✓${NC} .gitignore copied"
fi

# ---- 2. git init ----
if [[ -d .git ]]; then
  echo -e "  ${YELLOW}!${NC} git already initialized in this folder; skipping init"
else
  git init -b main
  echo -e "  ${GREEN}✓${NC} git initialized on branch 'main'"
fi

# ---- 3. set identity if missing ----
if ! git config user.email >/dev/null 2>&1; then
  echo ""
  read -p "  git user email (leave blank to skip): " GIT_EMAIL
  read -p "  git user name (leave blank to skip):  " GIT_NAME
  if [[ -n "$GIT_EMAIL" ]]; then
    git config user.email "$GIT_EMAIL"
    echo -e "  ${GREEN}✓${NC} user.email set to $GIT_EMAIL"
  fi
  if [[ -n "$GIT_NAME" ]]; then
    git config user.name "$GIT_NAME"
    echo -e "  ${GREEN}✓${NC} user.name set to $GIT_NAME"
  fi
fi

# ---- 4. safety check — no env files staged ----
echo ""
echo "Pre-stage safety check (looking for files that should NEVER be committed):"
DANGER=0
for pattern in ".env.local" ".env.production.local" "service-account*.json" "credentials*.json" "gcp-key.json"; do
  matches=$(find . -name "$pattern" -not -path "./node_modules/*" -not -path "./.next/*" -not -path "./.git/*" 2>/dev/null || true)
  if [[ -n "$matches" ]]; then
    echo -e "  ${YELLOW}!${NC} found ${pattern}:"
    echo "$matches" | sed 's/^/      /'
    if grep -qE "^\s*${pattern}\s*$" .gitignore 2>/dev/null || grep -qE "^\s*\*\.env\.local\s*$" .gitignore 2>/dev/null || grep -qE "^\s*\.env\*\s*$" .gitignore 2>/dev/null; then
      echo -e "      ${GREEN}✓${NC} matched by .gitignore — will not be staged"
    else
      echo -e "      ${RED}✗${NC} NOT in .gitignore — will be staged. Add it before continuing."
      DANGER=1
    fi
  fi
done
if [[ $DANGER -eq 1 ]]; then
  echo ""
  echo -e "  ${RED}Stopping.${NC} Add the listed files to .gitignore and re-run."
  exit 1
fi

# ---- 5. stage + commit ----
echo ""
git add -A
STAGED=$(git diff --cached --name-only | wc -l | tr -d ' ')
echo "  files staged: $STAGED"

# Final verification — list anything sensitive that snuck through
SUSPICIOUS=$(git diff --cached --name-only | grep -iE "\.env\.|secret|credentials|service-account|gcp-key" || true)
if [[ -n "$SUSPICIOUS" ]]; then
  echo ""
  echo -e "  ${RED}STOP — these look sensitive but are staged:${NC}"
  echo "$SUSPICIOUS" | sed 's/^/    /'
  echo ""
  echo "  Run: git rm --cached <file>  for each, then re-add to .gitignore."
  exit 1
fi

if git rev-parse --verify HEAD >/dev/null 2>&1; then
  # repo already has commits; just commit the new state
  if git diff --cached --quiet; then
    echo -e "  ${YELLOW}!${NC} nothing to commit"
  else
    git commit -m "Update working tree"
    echo -e "  ${GREEN}✓${NC} committed"
  fi
else
  git commit -m "Initial commit: Purity Lab Data dashboard + scaffolds"
  echo -e "  ${GREEN}✓${NC} initial commit created"
fi

# ---- 6. next-step hints ----
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Next:"
echo "  1. Create a PRIVATE GitHub repo at https://github.com/new"
echo "     (don't initialize with README/license — we already have those)"
echo "  2. Copy the repo URL and run:"
echo ""
echo "       git remote add origin <YOUR_GITHUB_URL>"
echo "       git push -u origin main"
echo ""
echo "  3. Then proceed to Phase 2 (Supabase) or Phase 3 (Vercel) in DEPLOY.md"
echo ""
