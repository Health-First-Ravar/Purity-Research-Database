# Purity Dashboard

Three-page internal tool for Purity Coffee: Research Hub (chat agent), Reports
(COA time-series), Bibliography (source database + semantic search). Editor role
curates a canon Q&A layer; a daily + manual (3/day) sync pulls new Drive content.

```
dashboard/
├── app/                      # Next.js 15 + Supabase + Anthropic + Voyage
│   ├── app/                  # App Router pages + API routes
│   │   ├── chat/             # Page 2 — Research Hub (default)
│   │   ├── reports/          # Page 1 — COA reports
│   │   ├── bibliography/     # Page 3 — Source DB + semantic search
│   │   ├── editor/           # Editor queue + promote-to-canon
│   │   ├── api/
│   │   │   ├── chat/route.ts
│   │   │   ├── editor/label/route.ts
│   │   │   └── update/{manual,cron}/route.ts
│   │   ├── _components/ManualUpdateButton.tsx
│   │   ├── layout.tsx globals.css page.tsx
│   ├── lib/
│   │   ├── supabase.ts anthropic.ts voyage.ts sync.ts
│   │   └── rag/{classify,retrieve,generate}.ts
│   ├── scripts/ingest-kb.ts  # seeds chunks from knowledge-base/
│   ├── supabase/migrations/0001_initial.sql
│   ├── package.json tsconfig.json next.config.ts
│   ├── tailwind.config.ts postcss.config.js
│   ├── vercel.json           # daily cron: 10:00 UTC
│   └── .env.example
└── seed-pipeline/            # Track 1 — scrape → cluster → draft
    ├── scrape_faq.py scrape_reddit.py
    ├── cluster_dedupe.py generate_drafts.py
    ├── requirements.txt README.md
```

## Stack

| Layer        | Choice                                       |
|--------------|----------------------------------------------|
| Frontend     | Next.js 15 App Router, Tailwind              |
| Hosting      | Vercel (serverless + cron)                   |
| Backend      | Supabase — Postgres + Auth + Storage + pgvector |
| LLM generate | Claude Sonnet 4.6                            |
| LLM classify | Claude Haiku 4.5                             |
| Embeddings   | Voyage `voyage-3-large` (1024-dim)           |
| Vector       | pgvector HNSW inside Supabase                |
| Auth         | Supabase magic-link; `profiles.role` ∈ {editor,user} |
| Observability| Supabase logs + Sentry (optional)            |

## First-time setup

1. Supabase project → copy URL, anon key, service-role key.
2. Run `supabase/migrations/0001_initial.sql` in the SQL editor (enables pgvector).
3. `cd app && npm install`
4. `cp .env.example .env.local` → fill in keys (Anthropic, Voyage, Supabase, Drive).
5. `npm run dev` → http://localhost:3000

## Seed the knowledge base

```bash
cd app
# Embeds /knowledge-base → sources + chunks (pgvector)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... \
  npm run ingest
```

This populates the Bibliography page and powers chat retrieval.

## Seed canon_qa (optional but recommended)

```bash
cd ../seed-pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scrape_faq.py --out seed_faq.jsonl --follow
python scrape_reddit.py --out seed_reddit.jsonl
python cluster_dedupe.py seed_faq.jsonl seed_reddit.jsonl --out clusters.jsonl
python generate_drafts.py clusters.jsonl --out seed_drafts.jsonl
# Then use a bulk-import script (TODO) to insert into canon_qa (status='draft').
```

## Roles

- **editor** — access to `/editor` queue; can label messages, promote to canon,
  manually trigger updates (3/day global cap), modify sources.
- **user** — customer-service agent; chat + read reports + bibliography. Escalates
  to Ildi/Jeremy when the chat flags insufficient evidence.

Role is a column on `profiles`. New accounts default to `user`; promote in the
Supabase UI or via `update profiles set role='editor' where email='…'`.

## Ops

- **Daily sync** — Vercel cron hits `/api/update/cron` at 10:00 UTC (≈06:00 ET).
- **Manual** — editor button; enforced 3/day global via `can_trigger_manual_update()` RPC.
- **Freshness** — every source carries a `freshness_tier`: `stable`, `weekly`, `batch`.
  Chat surfaces the tier so customer-service knows how fresh an answer is.
- **Escalation** — Sonnet returns `insufficient_evidence` and `confidence_score`;
  below floor (0.55) → `escalated=true` → appears in `/editor` queue.
