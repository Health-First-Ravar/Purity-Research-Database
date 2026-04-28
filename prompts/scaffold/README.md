# Scaffold: three Reva-mind features

Drop-in code for Claude Code to copy into `dashboard/app/`. Mirror this folder
structure into the live tree:

```
prompts/scaffold/                          →   dashboard/app/
├── supabase/migrations/0007_*.sql         →   supabase/migrations/0007_*.sql
├── supabase/migrations/0008_*.sql         →   supabase/migrations/0008_*.sql
├── supabase/migrations/0009_*.sql         →   supabase/migrations/0009_*.sql
├── lib/rag/audit-claim.ts                 →   lib/rag/audit-claim.ts
├── lib/rag/reva.ts                        →   lib/rag/reva.ts
├── app/api/audit/route.ts                 →   app/api/audit/route.ts
├── app/api/reva/route.ts                  →   app/api/reva/route.ts
├── app/api/reva/sessions/route.ts         →   app/api/reva/sessions/route.ts
├── app/audit/page.tsx                     →   app/audit/page.tsx
├── app/audit/_components/AuditForm.tsx    →   app/audit/_components/AuditForm.tsx
├── app/audit/_components/AuditResult.tsx  →   app/audit/_components/AuditResult.tsx
├── app/heatmap/page.tsx                   →   app/heatmap/page.tsx
├── app/heatmap/_components/TopicCell.tsx  →   app/heatmap/_components/TopicCell.tsx
├── app/heatmap/_components/TopicDrawer.tsx→   app/heatmap/_components/TopicDrawer.tsx
├── app/reva/page.tsx                      →   app/reva/page.tsx
├── app/reva/[session]/page.tsx            →   app/reva/[session]/page.tsx
├── app/reva/_components/RevaChat.tsx      →   app/reva/_components/RevaChat.tsx
├── app/reva/_components/ModeSwitcher.tsx  →   app/reva/_components/ModeSwitcher.tsx
├── app/reva/_components/SessionSidebar.tsx→   app/reva/_components/SessionSidebar.tsx
├── scripts/seed-question-topics.ts        →   scripts/seed-question-topics.ts
└── scripts/backfill-question-topics.ts    →   scripts/backfill-question-topics.ts
```

## Patches to existing files

These DO require touching the live tree. See `patches/` for diff notes:

- `lib/rag/classify.ts` — extend `Classification` with `topic_slugs: string[]`
- `app/api/chat/route.ts` — after the message insert, write `message_topics` rows
- `app/_components/NavLinks.tsx` — three new entries (Audit, Heatmap, Ask Reva)
- `package.json` — three new `npm run` scripts

## Order of work

1. Apply migrations 0007 → 0008 → 0009 with `supabase db push`
2. Copy `lib/rag/*` files
3. Copy API routes
4. Copy UI pages and components
5. Apply patches to existing files
6. Run `npm run seed-question-topics` once
7. Run `npm run backfill-question-topics` once
8. `npm run lint && npm run build`
9. Verify each feature against the acceptance criteria in
   `prompts/build-three-reva-features.md`

## Conventions honored

- Next.js 15 App Router; server components default, client where needed
- Supabase RLS: editor sees all, user sees own; non-editor 403 on operator surfaces
- pgvector + Voyage `voyage-3-large` (1024d); HNSW cosine indexes
- Tailwind tokens from `tailwind.config.ts`: `purity-bean`, `purity-cream`,
  `purity-aqua`, `purity-green`, `purity-paper`, `purity-mist`, `purity-shade`,
  `purity-ink`, `purity-rust`, `purity-muted`, `purity-slate`
- Health-claim language: "may support", "associated with", "research suggests"
- No em dashes in user-facing customer chat copy (operator surfaces are fine)
