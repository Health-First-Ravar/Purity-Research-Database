#!/usr/bin/env bash
# Vercel env-var sync + production deploy.
# Two modes:
#   bash prompts/deploy/scripts/03-deploy-vercel.sh env    # sync .env.local → Vercel production env
#   bash prompts/deploy/scripts/03-deploy-vercel.sh prod   # deploy to production
#   bash prompts/deploy/scripts/03-deploy-vercel.sh        # both, in order

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$ROOT/dashboard/app"
MODE="${1:-all}"

echo ""
echo "Vercel deploy helper"
echo "  app dir: $APP"
echo "  mode:    $MODE"
echo ""

# ---- 0. CLI installed ----
if ! command -v vercel >/dev/null 2>&1; then
  echo -e "  ${RED}✗${NC} vercel CLI not installed"
  echo "    install: npm install -g vercel"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} vercel $(vercel --version | head -1)"

# ---- 0b. linked? ----
cd "$APP"
if [[ ! -f .vercel/project.json ]]; then
  echo ""
  echo -e "  ${YELLOW}!${NC} project not linked to Vercel yet."
  echo "    Run from $APP:  vercel link"
  echo "    Then re-run this script."
  exit 1
fi
PROJECT_NAME=$(grep -oE '"projectName":\s*"[^"]+"' .vercel/project.json | cut -d'"' -f4)
echo -e "  ${GREEN}✓${NC} linked to project: $PROJECT_NAME"

# ---- ENV SYNC ----
sync_env() {
  echo ""
  echo "Sync .env.local → Vercel (production)"
  echo ""

  if [[ ! -f "$APP/.env.local" ]]; then
    echo -e "  ${RED}✗${NC} $APP/.env.local missing"
    return 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    # skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue
    [[ "$line" != *"="* ]] && continue

    KEY="${line%%=*}"
    VAL="${line#*=}"
    KEY="$(echo "$KEY" | xargs)"     # trim
    VAL="$(echo "$VAL" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    # strip surrounding quotes if present
    VAL="${VAL%\"}"; VAL="${VAL#\"}"
    VAL="${VAL%\'}"; VAL="${VAL#\'}"

    # skip placeholders
    if [[ -z "$VAL" ]] || [[ "$VAL" == "your-"* ]] || [[ "$VAL" == "sk-ant-..." ]] || [[ "$VAL" == "pa-..." ]] || [[ "$VAL" == "generate-a-long-random-string" ]]; then
      echo -e "  ${YELLOW}skip${NC} $KEY (placeholder or empty)"
      continue
    fi

    # decide whether to display value
    if [[ "$KEY" == *"KEY"* ]] || [[ "$KEY" == *"SECRET"* ]] || [[ "$KEY" == *"PASSWORD"* ]] || [[ "$KEY" == *"TOKEN"* ]]; then
      DISPLAY="(redacted, ${#VAL} chars)"
    else
      DISPLAY="$VAL"
    fi

    echo "  push $KEY = $DISPLAY ?"
    read -p "    [y/N] " CONFIRM
    if [[ "$CONFIRM" != "y" ]] && [[ "$CONFIRM" != "Y" ]]; then
      echo -e "    ${YELLOW}skipped${NC}"
      continue
    fi

    # remove existing then add fresh (Vercel doesn't have an upsert)
    vercel env rm "$KEY" production --yes >/dev/null 2>&1 || true
    echo "$VAL" | vercel env add "$KEY" production >/dev/null 2>&1
    echo -e "    ${GREEN}✓${NC} pushed"
  done < "$APP/.env.local"

  echo ""
  echo -e "  ${GREEN}✓${NC} env sync done"
}

# ---- DEPLOY ----
deploy_prod() {
  echo ""
  echo "Deploy to production"
  echo ""
  cd "$APP"
  vercel --prod
  echo ""
  echo -e "  ${GREEN}✓${NC} deploy command finished. Check the URL above."
}

case "$MODE" in
  env)
    sync_env
    ;;
  prod)
    deploy_prod
    ;;
  all|"")
    sync_env
    echo ""
    read -p "Now deploy to production? [y/N] " GO
    if [[ "$GO" == "y" ]] || [[ "$GO" == "Y" ]]; then
      deploy_prod
    else
      echo "  skipped deploy. Run again with: bash prompts/deploy/scripts/03-deploy-vercel.sh prod"
    fi
    ;;
  *)
    echo -e "  ${RED}✗${NC} unknown mode: $MODE (use: env | prod | all)"
    exit 1
    ;;
esac

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Done."
echo ""
echo "Verify the live URL:"
echo "  - login page loads"
echo "  - sign in (after creating user via Supabase Auth)"
echo "  - test /chat with a question"
echo ""
echo "If anything broke: vercel logs <url-from-deploy-output>"
echo ""
