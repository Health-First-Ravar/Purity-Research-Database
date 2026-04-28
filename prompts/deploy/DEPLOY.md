# Deploy Purity Lab Data to Vercel

End-to-end walkthrough to get your app off your laptop and onto a public URL.
After this, your computer can be off and the app stays up. Estimated time
for first deploy: 30-45 minutes.

## What you'll have at the end

- Public URL (e.g. `https://purity-lab-data.vercel.app`) gated by Supabase Auth
- All chat / audit / heatmap / reva endpoints live and serverless
- Daily cron job firing on Vercel infrastructure
- Auto-deploys on every git push

## What you need before starting

- A **GitHub account** (free tier is fine) — github.com/signup
- A **Vercel account** (free tier covers this) — vercel.com/signup, log in with GitHub
- Your **Supabase cloud project** already created with the URL + keys from
  `.env.local`. If you've only run Supabase locally, see "Cloud Supabase
  setup" below before starting.
- All your **API keys** ready (see env-vars table in Phase 4)
- **Terminal access** on your Mac
- The **Vercel CLI** installed: `npm install -g vercel` (we'll do this in Phase 3)

---

## Phase 0 — Pre-flight (10 minutes)

Run the pre-flight script. It checks what's set up and what's missing.

```bash
cd "/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data"
bash prompts/deploy/scripts/00-preflight.sh
```

Fix any red items it reports before continuing. Common things it'll flag:
- Missing `.env.local` in `dashboard/app/`
- `node_modules/` not installed (run `npm install` in `dashboard/app/`)
- Local build failing (run `npm run build` and look at errors)

You CANNOT deploy if `npm run build` fails locally. Vercel runs the same
build on their servers; it will fail there too.

---

## Phase 1 — Initialize git + push to GitHub (10 minutes)

The repo is currently NOT in git. We'll fix that first.

### 1a. Initialize git locally

```bash
cd "/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data"
bash prompts/deploy/scripts/01-init-git.sh
```

This script:
- Copies the proper `.gitignore` to the repo root (excludes `node_modules`, `.env.local`, Drive metadata, build artifacts)
- Runs `git init`
- Stages everything that should be committed
- Creates the initial commit

Verify nothing sensitive is tracked:

```bash
git ls-files | grep -E "(\.env|service-account|credentials)" || echo "clean"
```

Should print `clean`. If it lists any files, STOP and add them to `.gitignore`
before pushing.

### 1b. Create a GitHub repo

1. Go to **github.com/new**
2. Repository name: `purity-lab-data` (or whatever you prefer)
3. Set it to **Private** (the code includes proprietary brand prompts — don't make this public)
4. **Don't** add README / .gitignore / license — we already have those
5. Click "Create repository"
6. Copy the SSH or HTTPS URL it gives you (looks like `git@github.com:yourname/purity-lab-data.git`)

### 1c. Push

```bash
# replace with your actual GitHub URL
git remote add origin git@github.com:yourname/purity-lab-data.git
git branch -M main
git push -u origin main
```

If git asks for credentials and you don't have SSH set up, use the HTTPS
URL instead and use a GitHub Personal Access Token as the password
(github.com/settings/tokens → Fine-grained, scope: this repo, contents:
read+write).

After this, your code is on GitHub. Visit the repo URL to confirm.

---

## Phase 2 — Cloud Supabase (5-15 minutes, skip if already on cloud)

If your `.env.local` has `NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co`
and you've been using that URL during local dev, **skip to Phase 3** —
you're already on cloud Supabase.

If you've been using local Supabase (`supabase start`), you need to push
the schema to a cloud project first.

### 2a. Create cloud project (if you don't have one)

1. Go to **supabase.com/dashboard**
2. New Project → pick org, name it `purity-lab-data`, choose a strong DB password (save it)
3. Pick the closest region
4. Wait ~2 minutes for provisioning
5. From the project dashboard, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role secret key → `SUPABASE_SERVICE_ROLE_KEY`
6. Update your local `.env.local` with these values
7. **Project Settings → Database → Extensions** → enable `vector` (pgvector) and `pgcrypto`

### 2b. Push migrations

```bash
cd "/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data"
bash prompts/deploy/scripts/02-push-supabase.sh
```

The script will:
- Verify Supabase CLI is installed (or tell you to install it)
- Run `supabase link --project-ref <ref>` (you'll be prompted for the ref)
- Run `supabase db push` to apply migrations 0001 through 0009
- Print the resulting table list for verification

If you've already applied 0001-0006 to the cloud project but not 0007-0009
yet, the push will only apply the new ones — `supabase db push` is idempotent
on already-applied migrations.

---

## Phase 3 — Deploy to Vercel (10-15 minutes)

### 3a. Install + login to Vercel CLI

```bash
npm install -g vercel
vercel login
```

Use the same email as your GitHub-linked Vercel account. It opens a browser
for confirmation.

### 3b. Link the project

```bash
cd "/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data/dashboard/app"
vercel link
```

Answer the prompts:
- Set up "purity-lab-data"? → **Y**
- Link to existing project? → **N** (this is new)
- What's your project's name? → **purity-lab-data** (or whatever you want)
- In which directory is your code located? → **./** (we're already in `dashboard/app`)

This creates `.vercel/project.json` which links this folder to the new Vercel project. (`.vercel/` is already in `.gitignore`.)

### 3c. Add environment variables

The script `03-deploy-vercel.sh` automates this. It reads your local
`.env.local` and pushes each variable to Vercel for the **production**
environment.

```bash
cd "/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data"
bash prompts/deploy/scripts/03-deploy-vercel.sh env
```

It skips comments and empty values, asks before pushing each variable, and
echoes confirmation. Sensitive values (anything with `KEY` or `SECRET` in
the name) are not echoed back to your terminal.

If you'd rather do it in the UI: vercel.com → your project → Settings →
Environment Variables → add each one from the table below.

### 3d. Required env vars (must all be set before first deploy)

| Variable | Source | Sensitive? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project dashboard | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project dashboard | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project dashboard | **Yes** — server-only |
| `ANTHROPIC_API_KEY` | console.anthropic.com | **Yes** |
| `ANTHROPIC_MODEL_GENERATE` | optional, defaults to `claude-sonnet-4-6` | No |
| `ANTHROPIC_MODEL_CLASSIFY` | optional, defaults to `claude-haiku-4-5-20251001` | No |
| `VOYAGE_API_KEY` | voyageai.com | **Yes** |
| `VOYAGE_MODEL` | optional, defaults to `voyage-3-large` | No |
| `CRON_SECRET` | generate any long random string | **Yes** |

Optional (set if you have them):

| Variable | Used for |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Drive sync (COA + research ingestion) |
| `DRIVE_COA_FOLDER_ID` | Google Drive sync |
| `DRIVE_RESEARCH_FOLDER_ID` | Google Drive sync |
| `SENTRY_DSN` | Error tracking |

### 3e. Deploy

```bash
cd "/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data"
bash prompts/deploy/scripts/03-deploy-vercel.sh prod
```

OR manually:

```bash
cd dashboard/app
vercel --prod
```

Vercel will:
1. Upload your code (skips `node_modules` — installs fresh on their build machine)
2. Run `npm install`
3. Run `npm run build`
4. Make the result live at your Vercel URL

When it finishes (3-5 minutes for first deploy) it prints the URL. Save it.

---

## Phase 4 — Post-deploy verification (5 minutes)

### 4a. Smoke test

Visit the URL Vercel gave you. You should see the login page.

If the build failed, check the build log: `vercel logs <url>` or in the
Vercel dashboard. Most common causes:
- Missing env var (`Error: ANTHROPIC_API_KEY not set` etc.) → add it in
  Vercel settings, click "Redeploy"
- TypeScript error that doesn't fire locally because of cached state → run
  `rm -rf .next && npm run build` locally to reproduce

### 4b. Create your first user

In Supabase dashboard → Authentication → Users → **Invite user**:
- Email: yours
- Role: editor (you'll set this manually after they sign up)

You'll get an invite email. Sign up, then in Supabase SQL Editor:

```sql
update public.profiles set role = 'editor' where email = 'jravar@puritycoffee.com';
```

Without this step, you'll log in as a regular user and won't see the
editor-only pages (heatmap, reva, metrics, editor).

### 4c. Test the live app

- Log in
- Visit `/chat` — ask "Is PROTECT good for someone with acid reflux?"
- Verify the answer comes back (uses cloud Anthropic API + cloud Supabase)
- Visit `/metrics` — should show your new conversation in the count
- Click the Reva helper bottom-left, type "where do I find COAs?"

If all three work, the app is fully deployed and your laptop is no longer
required.

---

## Phase 5 — Set up auto-deploys (2 minutes)

Once linked, Vercel auto-deploys every git push. To verify:

```bash
cd "/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data"
echo "deployed $(date)" >> README.md
git add README.md
git commit -m "test auto-deploy"
git push
```

Watch the Vercel dashboard — a new deployment kicks off automatically and
takes ~2-3 minutes. The URL stays the same; the new code replaces the old.

---

## Things that change after deploy

### Your laptop is no longer the runtime

The app runs on Vercel's serverless infrastructure (functions spin up
on-demand). Your laptop being on / off / asleep / in your bag has no effect.

### Costs

Free tier on all three services covers low-traffic personal use:
- Vercel free: 100 GB bandwidth, 100 GB-hours function execution per month
- Supabase free: 500 MB DB, 2 GB bandwidth, 50K monthly active users
- Anthropic / Voyage: pay-as-you-go (your existing keys, your usage)

If you hit traffic that needs more, Vercel Pro is $20/mo and Supabase Pro
is $25/mo. Plenty of runway before that.

### Daily cron

The cron in `vercel.json` fires `/api/update/cron` daily at 10:00 UTC. It's
gated by `CRON_SECRET` so external callers can't trigger it. Vercel handles
the scheduling.

### Updates after deploy

Make code changes locally → commit → push. Vercel auto-deploys within 2-3
minutes. No manual deploy step needed unless you want to control timing,
in which case use `vercel --prod` from `dashboard/app/`.

---

## Rollback

If a deploy breaks production, you have two paths:

### Fast path (CLI, ~30 seconds)

```bash
# Auto-promote the previous ready deployment:
bash prompts/deploy/scripts/04-rollback.sh previous

# Or interactively pick which deployment to promote:
bash prompts/deploy/scripts/04-rollback.sh

# Or just list what's available:
bash prompts/deploy/scripts/04-rollback.sh list

# Or tail logs first to figure out what broke before rolling back:
bash prompts/deploy/scripts/04-rollback.sh logs <deployment-url>
```

The script confirms before doing anything destructive. You type the word
`promote` to proceed; anything else aborts.

### UI path (slower but visual)

1. Vercel dashboard → your project → Deployments
2. Find the last working deployment in the list
3. Click the three-dot menu → "Promote to Production"

Either way, the bad deployment isn't deleted; you can flip back to it if
the rollback was wrong (run the script again with that URL).

### DB-level rollback

For Supabase issues, automatic backups are kept on a rolling 7-day window
(free tier). Restore from Supabase dashboard → Database → Backups. This is
a heavier operation than promoting a previous Vercel deployment — only do
it if a migration corrupted data, not for app-level bugs.

---

## What this walkthrough does NOT do

- Custom domain (e.g. `dashboard.puritycoffee.com`) — that's a separate
  step in Vercel Settings → Domains. Easy but requires DNS changes.
- Email-sending setup for Supabase Auth invites — uses Supabase's default
  sender (low volume, fine for inviting team members; for customer email
  later, integrate Resend or Postmark).
- Production-grade observability — `SENTRY_DSN` is wired in if you set it,
  but full instrumentation (logging spans, custom dashboards) is a separate
  engagement.

## Files in this deployment package

```
prompts/deploy/
├── DEPLOY.md                            (this file)
├── .gitignore                           (copy to repo root)
├── vercel.json                          (improved version of dashboard/app/vercel.json)
└── scripts/
    ├── 00-preflight.sh                  (sanity check before starting)
    ├── 01-init-git.sh                   (git init + initial commit)
    ├── 02-push-supabase.sh              (cloud DB schema push)
    ├── 03-deploy-vercel.sh              (env-var sync + production deploy)
    └── 04-rollback.sh                   (insurance: list / log / promote previous deployment)
```

Run the scripts in order. Each one is safe to re-run if you need to retry.
