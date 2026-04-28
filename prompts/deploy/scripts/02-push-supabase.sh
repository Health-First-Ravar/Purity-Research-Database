#!/usr/bin/env bash
# Push migrations to cloud Supabase project.
# Run from repo root: bash prompts/deploy/scripts/02-push-supabase.sh

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$ROOT/dashboard/app"

echo ""
echo "Push Supabase migrations to cloud"
echo "  app dir: $APP"
echo ""

# ---- 1. supabase CLI ----
if ! command -v supabase >/dev/null 2>&1; then
  echo -e "  ${RED}✗${NC} supabase CLI not installed"
  echo "    install: brew install supabase/tap/supabase"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} supabase $(supabase --version)"

# ---- 2. read project URL from .env.local ----
if [[ ! -f "$APP/.env.local" ]]; then
  echo -e "  ${RED}✗${NC} $APP/.env.local missing"
  exit 1
fi
SUPABASE_URL=$(grep -E "^NEXT_PUBLIC_SUPABASE_URL=" "$APP/.env.local" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
if [[ -z "$SUPABASE_URL" ]] || [[ "$SUPABASE_URL" == "https://your-project.supabase.co" ]]; then
  echo -e "  ${RED}✗${NC} NEXT_PUBLIC_SUPABASE_URL is missing or placeholder"
  echo "    set it in $APP/.env.local with your real cloud project URL"
  exit 1
fi
PROJECT_REF=$(echo "$SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|')
if [[ -z "$PROJECT_REF" ]] || [[ "$PROJECT_REF" == "$SUPABASE_URL" ]]; then
  echo -e "  ${RED}✗${NC} could not parse project ref from $SUPABASE_URL"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} project ref: $PROJECT_REF"

# ---- 3. supabase login (if needed) ----
echo ""
echo "  supabase login (browser will open if not already authenticated)"
supabase login || { echo -e "  ${RED}✗${NC} login failed"; exit 1; }

# ---- 4. link ----
cd "$APP"
echo ""
echo "  linking to project $PROJECT_REF..."
supabase link --project-ref "$PROJECT_REF" || { echo -e "  ${RED}✗${NC} link failed"; exit 1; }
echo -e "  ${GREEN}✓${NC} linked"

# ---- 5. push ----
echo ""
echo "  pushing migrations (this is idempotent — already-applied migrations are skipped)"
supabase db push || { echo -e "  ${RED}✗${NC} push failed; check logs above"; exit 1; }
echo -e "  ${GREEN}✓${NC} migrations applied"

# ---- 6. verify tables exist ----
echo ""
echo "  verifying schema (counting public tables)..."
TABLE_COUNT=$(supabase db dump --schema public --data-only=false 2>/dev/null | grep -cE "^CREATE TABLE" || echo "?")
echo "  public tables created: $TABLE_COUNT"
echo "  expected: 8+ (profiles, sources, chunks, canon_qa, messages, reviews, update_jobs, coas, claim_audits, question_topics, message_topics, reva_sessions, reva_messages, rate_limits, escalation_events)"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}Done.${NC} Schema pushed to $PROJECT_REF."
echo "  Verify in Supabase dashboard → Table Editor."
echo "  Next: bash prompts/deploy/scripts/03-deploy-vercel.sh env"
echo ""
