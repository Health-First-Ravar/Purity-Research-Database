#!/usr/bin/env bash
# Pre-flight check before deploying. Validates local environment is ready.
# Run from repo root: bash prompts/deploy/scripts/00-preflight.sh

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}!${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} $1"; FAILED=1; }

FAILED=0
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$ROOT/dashboard/app"

echo ""
echo "Pre-flight check"
echo "  repo root: $ROOT"
echo "  app dir:   $APP"
echo ""

# ---- 1. tools ----
echo "Tools:"
command -v node    >/dev/null 2>&1 && ok "node $(node --version)"        || fail "node not found"
command -v npm     >/dev/null 2>&1 && ok "npm $(npm --version)"          || fail "npm not found"
command -v git     >/dev/null 2>&1 && ok "git $(git --version | awk '{print $3}')" || fail "git not found (install: brew install git)"

if command -v vercel >/dev/null 2>&1; then
  ok "vercel $(vercel --version | head -1)"
else
  warn "vercel CLI not installed yet (will install in Phase 3: npm install -g vercel)"
fi

if command -v supabase >/dev/null 2>&1; then
  ok "supabase $(supabase --version)"
else
  warn "supabase CLI not installed (only needed if you'll push migrations: brew install supabase/tap/supabase)"
fi

echo ""

# ---- 2. project files ----
echo "Project files:"
[[ -d "$APP" ]]                       && ok "dashboard/app/ exists"           || fail "dashboard/app/ not found"
[[ -f "$APP/package.json" ]]          && ok "package.json present"            || fail "package.json missing"
[[ -f "$APP/next.config.ts" ]]        && ok "next.config.ts present"          || fail "next.config.ts missing"
[[ -f "$APP/tailwind.config.ts" ]]    && ok "tailwind.config.ts present"      || fail "tailwind.config.ts missing"
[[ -f "$APP/.env.example" ]]          && ok ".env.example present"            || warn ".env.example missing"
[[ -f "$APP/vercel.json" ]]           && ok "dashboard/app/vercel.json present" || warn "dashboard/app/vercel.json missing — copy prompts/deploy/vercel.json there"

if [[ -f "$APP/.env.local" ]]; then
  ok ".env.local present"
else
  fail ".env.local missing — copy .env.example to .env.local and fill in"
fi

echo ""

# ---- 3. dependencies installed ----
echo "Dependencies:"
if [[ -d "$APP/node_modules" ]]; then
  ok "node_modules installed"
else
  fail "node_modules missing — run: cd dashboard/app && npm install"
fi

echo ""

# ---- 4. critical env vars ----
echo "Required env vars in .env.local:"
if [[ -f "$APP/.env.local" ]]; then
  for var in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY ANTHROPIC_API_KEY VOYAGE_API_KEY CRON_SECRET; do
    if grep -qE "^${var}=.+" "$APP/.env.local" 2>/dev/null; then
      val="$(grep -E "^${var}=" "$APP/.env.local" | head -1 | cut -d= -f2-)"
      if [[ "$val" == "your-"* ]] || [[ "$val" == "sk-ant-..." ]] || [[ "$val" == "pa-..." ]] || [[ -z "$val" ]] || [[ "$val" == "generate-a-long-random-string" ]]; then
        fail "$var has placeholder value"
      else
        ok "$var set"
      fi
    else
      fail "$var not in .env.local"
    fi
  done
else
  fail ".env.local missing"
fi

echo ""

# ---- 5. git status ----
echo "Git status:"
if [[ -d "$ROOT/.git" ]]; then
  ok "git initialized"
  cd "$ROOT"
  if git remote -v 2>/dev/null | grep -q origin; then
    ok "remote 'origin' configured: $(git remote get-url origin)"
  else
    warn "no git remote — set up GitHub in Phase 1c"
  fi
else
  warn "git NOT initialized — run prompts/deploy/scripts/01-init-git.sh"
fi

echo ""

# ---- 6. local build (slow but the most important check) ----
echo "Local build (this proves Vercel will succeed):"
echo "  running: cd dashboard/app && npm run build (this takes 30-90 seconds)"
cd "$APP"
if npm run build > /tmp/preflight-build.log 2>&1; then
  ok "npm run build succeeds locally"
else
  fail "npm run build FAILS locally — Vercel will fail too. Last 20 lines:"
  tail -20 /tmp/preflight-build.log | sed 's/^/      /'
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
if [[ $FAILED -eq 0 ]]; then
  echo -e "${GREEN}All checks passed.${NC} You're ready to proceed to Phase 1."
  exit 0
else
  echo -e "${RED}Some checks failed.${NC} Fix the items above before continuing."
  exit 1
fi
