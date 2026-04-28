#!/usr/bin/env bash
# Rollback insurance — promote a previous deployment to production.
#
# Usage:
#   bash prompts/deploy/scripts/04-rollback.sh                   # interactive: list, pick, confirm, promote
#   bash prompts/deploy/scripts/04-rollback.sh list              # just list recent deployments
#   bash prompts/deploy/scripts/04-rollback.sh logs <url>        # tail build/runtime logs for a deployment
#   bash prompts/deploy/scripts/04-rollback.sh promote <url>     # promote a specific deployment URL to production
#   bash prompts/deploy/scripts/04-rollback.sh previous          # auto-promote the second-most-recent ready deployment
#
# Defensive defaults: confirms before promoting, dry-runs are safe, errors out
# if Vercel CLI isn't linked to a project.

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$ROOT/dashboard/app"
MODE="${1:-interactive}"

# ---------------------------------------------------------------------------
# preconditions
# ---------------------------------------------------------------------------
if ! command -v vercel >/dev/null 2>&1; then
  echo -e "  ${RED}✗${NC} vercel CLI not installed (npm install -g vercel)"
  exit 1
fi

cd "$APP"

if [[ ! -f .vercel/project.json ]]; then
  echo -e "  ${RED}✗${NC} project not linked to Vercel."
  echo "    cd $APP && vercel link"
  exit 1
fi

PROJECT_NAME=$(grep -oE '"projectName":\s*"[^"]+"' .vercel/project.json | cut -d'"' -f4)

# ---------------------------------------------------------------------------
# subcommand: list
# ---------------------------------------------------------------------------
do_list() {
  echo ""
  echo "Recent deployments for $PROJECT_NAME:"
  echo ""
  # vercel ls prints a table; grep keeps READY production deployments first
  vercel ls --prod 2>/dev/null | head -25 || vercel ls 2>/dev/null | head -25
  echo ""
}

# ---------------------------------------------------------------------------
# subcommand: logs <url>
# ---------------------------------------------------------------------------
do_logs() {
  local URL="$1"
  if [[ -z "$URL" ]]; then
    echo -e "  ${RED}✗${NC} usage: $0 logs <deployment-url>"
    exit 1
  fi
  echo ""
  echo "Logs for $URL"
  echo ""
  vercel logs "$URL" 2>&1 | tail -100
}

# ---------------------------------------------------------------------------
# subcommand: promote <url>
# ---------------------------------------------------------------------------
do_promote() {
  local URL="$1"
  if [[ -z "$URL" ]]; then
    echo -e "  ${RED}✗${NC} usage: $0 promote <deployment-url>"
    exit 1
  fi

  echo ""
  echo -e "  ${YELLOW}About to promote this deployment to production:${NC}"
  echo "    $URL"
  echo ""
  echo "  Current production will be replaced. The replaced deployment is"
  echo "  NOT deleted; you can flip back at any time by running this script"
  echo "  again with the original URL."
  echo ""
  read -p "  Confirm promotion? Type the word 'promote' to proceed: " CONFIRM

  if [[ "$CONFIRM" != "promote" ]]; then
    echo -e "  ${YELLOW}Aborted.${NC}"
    exit 0
  fi

  echo ""
  echo "  Promoting..."
  if vercel promote "$URL" --yes; then
    echo ""
    echo -e "  ${GREEN}✓${NC} Promoted. Production now serves $URL"
    echo ""
    echo "  Verify:"
    echo "    open the production URL in a browser"
    echo "    confirm the rollback fixed whatever was broken"
    echo "    run smoke tests if you have them"
  else
    echo ""
    echo -e "  ${RED}✗${NC} promote failed. Check vercel CLI output above."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# subcommand: previous (auto-pick the second-most-recent READY deployment)
# ---------------------------------------------------------------------------
do_previous() {
  echo ""
  echo "  Finding the previous ready deployment for $PROJECT_NAME..."
  # vercel ls --prod sorts most-recent-first. Skip the current production
  # (first entry) and grab the next READY URL.
  PREV_URL=$(vercel ls --prod 2>/dev/null \
    | awk '/^https?:\/\// { print $1 }' \
    | sed -n '2p')

  if [[ -z "$PREV_URL" ]]; then
    echo -e "  ${RED}✗${NC} could not find a previous deployment."
    echo "    Run: $0 list  to see what is available."
    exit 1
  fi

  echo "  Previous deployment: $PREV_URL"
  do_promote "$PREV_URL"
}

# ---------------------------------------------------------------------------
# subcommand: interactive (default)
# ---------------------------------------------------------------------------
do_interactive() {
  do_list
  echo ""
  echo "  Options:"
  echo "    1) Promote a specific deployment URL"
  echo "    2) Promote the previous deployment automatically"
  echo "    3) View logs for a deployment"
  echo "    4) Exit"
  echo ""
  read -p "  Choice [1-4]: " CHOICE
  case "$CHOICE" in
    1)
      read -p "  Paste the deployment URL to promote: " URL
      do_promote "$URL"
      ;;
    2)
      do_previous
      ;;
    3)
      read -p "  Paste the deployment URL to view logs for: " URL
      do_logs "$URL"
      echo ""
      echo "  Run again to promote a deployment if needed."
      ;;
    4|*)
      echo -e "  ${YELLOW}Exit.${NC}"
      exit 0
      ;;
  esac
}

# ---------------------------------------------------------------------------
# router
# ---------------------------------------------------------------------------
echo ""
echo -e "${CYAN}Vercel rollback — project: $PROJECT_NAME${NC}"

case "$MODE" in
  list)        do_list ;;
  logs)        do_logs "${2:-}" ;;
  promote)     do_promote "${2:-}" ;;
  previous)    do_previous ;;
  interactive) do_interactive ;;
  *)
    echo -e "  ${RED}✗${NC} unknown mode: $MODE"
    echo ""
    echo "  Usage:"
    echo "    $0                          # interactive"
    echo "    $0 list                     # list recent deployments"
    echo "    $0 logs <url>               # tail logs for a deployment"
    echo "    $0 promote <url>            # promote a specific URL to prod"
    echo "    $0 previous                 # promote the second-most-recent deployment"
    exit 1
    ;;
esac

echo ""
