// Lightweight, repo-native migration runner.
//
// Applies every migrations/*.sql file that hasn't been applied yet, in
// filename order, each inside its own transaction, and records it in
// public.schema_migrations. Re-running is safe: already-applied files skip.
//
// Usage (from dashboard/app):
//   npm run migrate
// which runs:  node --env-file=.env.local scripts/migrate.mjs
//
// Requires SUPABASE_DB_URL in the environment (Supabase → Settings → Database →
// Connection string → URI; use the pooler/session string and append ?sslmode=require).
//
// NOTE: keep statements transaction-safe. If a migration must run outside a
// transaction (e.g. CREATE INDEX CONCURRENTLY), name the file *.notx.sql and
// it will be run without the wrapping BEGIN/COMMIT.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations/', import.meta.url));

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('ERROR: SUPABASE_DB_URL not set. Add it to dashboard/app/.env.local');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

await client.query(`
  create table if not exists public.schema_migrations (
    version     text primary key,
    applied_at  timestamptz not null default now()
  );
`);

const { rows } = await client.query('select version from public.schema_migrations');
const applied = new Set(rows.map((r) => r.version));

let files;
try {
  files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
} catch {
  console.error(`ERROR: no migrations/ directory at ${MIGRATIONS_DIR}`);
  await client.end();
  process.exit(1);
}

let appliedCount = 0;
for (const f of files) {
  const version = f.replace(/\.sql$/, '');
  if (applied.has(version)) {
    console.log(`skip   ${version}`);
    continue;
  }
  const sql = await readFile(MIGRATIONS_DIR + f, 'utf8');
  const noTx = f.endsWith('.notx.sql');
  console.log(`apply  ${version}${noTx ? '  (no transaction)' : ''} ...`);
  try {
    if (noTx) {
      await client.query(sql);
      await client.query('insert into public.schema_migrations(version) values($1)', [version]);
    } else {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into public.schema_migrations(version) values($1)', [version]);
      await client.query('commit');
    }
    appliedCount++;
    console.log('  ok');
  } catch (e) {
    if (!noTx) await client.query('rollback').catch(() => {});
    console.error(`  FAILED: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}

console.log(`\ndone: ${appliedCount} applied, ${files.length - appliedCount} skipped`);
await client.end();
