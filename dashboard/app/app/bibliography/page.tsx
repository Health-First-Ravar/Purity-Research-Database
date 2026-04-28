import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { CiteButton } from './_components/CiteButton';
import { DebouncedTitleInput } from './_components/DebouncedTitleInput';
import { FormAutoSubmit } from './_components/FormAutoSubmit';
import { SortableHeader } from './_components/SortableHeader';
import { EmptyState } from '../_components/EmptyState';

// Two-column bibliography:
//   left  = catalog (sources / bibliography_view), filterable by topic / rights / year
//   right = semantic search across chunk-level full text (pgvector)

export const dynamic = 'force-dynamic';

type Search = {
  q?: string;            // semantic chunk search
  title?: string;        // catalog title ilike
  topic?: string;        // drive_location (high-level)
  category?: string;     // topic_category (fine-grained)
  rights?: string;       // rights_download filter
  year_from?: string;
  year_to?: string;
  pdf_only?: string;
  open_only?: string;    // rights-download == open-access set
  sort?: string;         // col:dir, e.g. "year_published:asc"
};

const SORTABLE = new Set(['year_published', 'title', 'topic_category', 'drive_location', 'rights_download']);

const RIGHTS_OPTS = [
  { v: '',                     l: 'any rights' },
  { v: 'open',                 l: 'open access / free' },
  { v: 'Yes - Open Access',    l: 'Open Access' },
  { v: 'Yes - Free via PMC',   l: 'Free via PMC' },
  { v: 'Yes - Free access',    l: 'Free access' },
  { v: 'No - Subscription',    l: 'Subscription only' },
];

export default async function BibliographyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const supabase = supabaseServer(await cookies());

  // Parse sort param: default year_published:desc
  const [rawCol, rawDir] = (params.sort ?? 'year_published:desc').split(':');
  const sortCol = SORTABLE.has(rawCol) ? rawCol : 'year_published';
  const sortDir: 'asc' | 'desc' = rawDir === 'asc' ? 'asc' : 'desc';

  // Left column: paginated catalog.
  let q = supabase
    .from('bibliography_view')
    .select('*')
    .order(sortCol, { ascending: sortDir === 'asc', nullsFirst: false })
    .order('title', { ascending: true })
    .limit(500);

  if (params.topic)     q = q.eq('drive_location', params.topic);
  if (params.category)  q = q.eq('topic_category', params.category);
  if (params.year_from) q = q.gte('year_published', Number(params.year_from));
  if (params.year_to)   q = q.lte('year_published', Number(params.year_to));
  if (params.pdf_only === '1') q = q.eq('has_pdf', true);
  if (params.open_only === '1' || params.rights === 'open') {
    q = q.in('rights_download', ['Yes - Open Access', 'Yes - Free via PMC', 'Yes - Free access']);
  } else if (params.rights) {
    q = q.eq('rights_download', params.rights);
  }
  if (params.title && params.title.trim()) {
    // Safe ilike — Supabase escapes; we still strip % to prevent wildcard tricks.
    q = q.ilike('title', `%${params.title.replace(/%/g, '')}%`);
  }

  const { data: rows, error, count } = await q;

  // Topic facet — pull distinct drive_location for the filter dropdown.
  const { data: topicRows } = await supabase
    .from('bibliography_view')
    .select('drive_location, topic_category')
    .limit(2000);
  const topics = Array.from(
    new Set((topicRows ?? []).map((r) => r.drive_location).filter(Boolean)),
  ).sort();
  const categories = Array.from(
    new Set((topicRows ?? []).map((r) => r.topic_category).filter(Boolean)),
  ).sort();

  let searchResults: SemanticHit[] = [];
  if (params.q && params.q.trim()) searchResults = await semanticSearch(params.q.trim());

  return (
    <div>
      <h1 className="mb-2 font-serif text-2xl">Bibliography</h1>
      <p className="mb-4 text-sm text-purity-muted dark:text-purity-mist">
        {rows?.length ?? 0} of {count ?? rows?.length ?? 0} entries · catalog on the left, semantic
        search across full text on the right.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 font-serif text-lg">Catalog</h2>
          <form className="mb-3 grid gap-2 text-sm md:grid-cols-6">
            <FormAutoSubmit />
            <DebouncedTitleInput initial={params.title ?? ''} />
            <select aria-label="Filter by topic" name="topic" defaultValue={params.topic ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper">
              <option value="">all topics</option>
              {topics.map((t) => <option key={t as string} value={t as string}>{t as string}</option>)}
            </select>
            <select aria-label="Filter by category" name="category" defaultValue={params.category ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper">
              <option value="">all categories</option>
              {categories.map((c) => <option key={c as string} value={c as string}>{c as string}</option>)}
            </select>
            <input type="number" min="1900" max="2100" aria-label="Publication year from" name="year_from" placeholder="from" defaultValue={params.year_from ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper dark:placeholder:text-purity-mist/70" />
            <input type="number" min="1900" max="2100" aria-label="Publication year to" name="year_to" placeholder="to" defaultValue={params.year_to ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper dark:placeholder:text-purity-mist/70" />
            <select aria-label="Filter by rights" name="rights" defaultValue={params.rights ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper md:col-span-2">
              {RIGHTS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-purity-bean dark:text-purity-paper">
              <input type="checkbox" name="pdf_only" value="1" defaultChecked={params.pdf_only === '1'} />
              has PDF
            </label>
            <label className="flex items-center gap-2 text-xs text-purity-bean dark:text-purity-paper">
              <input type="checkbox" name="open_only" value="1" defaultChecked={params.open_only === '1'} />
              open access only
            </label>
            <div className="md:col-span-6 flex gap-2">
              <button className="rounded-md bg-purity-bean px-3 py-1 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink">Apply</button>
              <a href="/bibliography" className="rounded-md border border-purity-bean/20 px-3 py-1 text-xs text-purity-muted dark:border-purity-paper/20 dark:text-purity-mist">Clear</a>
            </div>
          </form>

          <div className="max-h-[70vh] overflow-auto rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-xs text-purity-muted dark:text-purity-mist">
                  <th className="sticky top-0 z-10 border-b border-purity-bean/15 bg-purity-cream p-2 dark:border-purity-paper/15 dark:bg-purity-ink">
                    <SortableHeader col="year_published" label="Year" currentCol={sortCol} currentDir={sortDir} />
                  </th>
                  <th className="sticky top-0 z-10 border-b border-purity-bean/15 bg-purity-cream p-2 dark:border-purity-paper/15 dark:bg-purity-ink">
                    <SortableHeader col="title" label="Title" currentCol={sortCol} currentDir={sortDir} />
                  </th>
                  <th className="sticky top-0 z-10 border-b border-purity-bean/15 bg-purity-cream p-2 dark:border-purity-paper/15 dark:bg-purity-ink">
                    <SortableHeader col="drive_location" label="Topic" currentCol={sortCol} currentDir={sortDir} />
                  </th>
                  <th className="sticky top-0 z-10 border-b border-purity-bean/15 bg-purity-cream p-2 dark:border-purity-paper/15 dark:bg-purity-ink">
                    <SortableHeader col="rights_download" label="Rights" currentCol={sortCol} currentDir={sortDir} />
                  </th>
                  <th className="sticky top-0 z-10 border-b border-purity-bean/15 bg-purity-cream p-2 dark:border-purity-paper/15 dark:bg-purity-ink">DOI</th>
                  <th className="sticky top-0 z-10 border-b border-purity-bean/15 bg-purity-cream p-2 dark:border-purity-paper/15 dark:bg-purity-ink"></th>
                </tr>
              </thead>
              <tbody>
                {error && <tr><td colSpan={5} className="p-3 text-purity-rust">{error.message}</td></tr>}
                {rows?.map((r) => (
                  <tr key={r.id} className="border-b border-purity-bean/5 align-top dark:border-purity-paper/5">
                    <td className="p-2 text-xs">{r.year_published ?? '—'}</td>
                    <td className="p-2">
                      <div className="font-medium">{r.title}</div>
                      {r.topic_category && <div className="text-xs text-purity-muted dark:text-purity-mist">{r.topic_category}</div>}
                    </td>
                    <td className="p-2 text-xs">{r.drive_location ?? '—'}</td>
                    <td className="p-2 text-xs">
                      <RightsBadge download={r.rights_download} hasPdf={r.has_pdf} />
                    </td>
                    <td className="p-2">
                      {r.doi ? (
                        <a
                          href={r.drive_url ?? `https://doi.org/${r.doi}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-purity-green underline dark:text-purity-aqua"
                        >
                          {r.doi}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="p-2 text-right">
                      <CiteButton row={{
                        id: r.id,
                        title: r.title,
                        year_published: r.year_published ?? null,
                        doi: r.doi ?? null,
                        drive_url: r.drive_url ?? null,
                        topic_category: r.topic_category ?? null,
                      }} />
                    </td>
                  </tr>
                ))}
                {(!rows || rows.length === 0) && !error && (
                  <tr><td colSpan={6} className="p-4">
                    <EmptyState
                      title="No matches"
                      body={
                        params.title || params.topic || params.category || params.year_from || params.year_to
                          ? 'Try loosening the filters or clearing search.'
                          : <>No catalog rows yet. Run <code className="font-mono">npm run import-bibliography</code>.</>
                      }
                      action={
                        params.title || params.topic || params.category || params.year_from || params.year_to
                          ? { label: 'Clear filters', href: '/bibliography' }
                          : undefined
                      }
                    />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-serif text-lg">Search</h2>
          <form className="mb-3 flex gap-2 text-sm" role="search" aria-label="Full-text search across bibliography">
            <input
              aria-label="Semantic search query"
              name="q"
              defaultValue={params.q ?? ''}
              placeholder="semantic — 'OTA reduction during roasting', 'CGA bioavailability', etc."
              className="flex-1 rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper dark:placeholder:text-purity-mist/70"
            />
            <button className="rounded-md bg-purity-green px-3 py-1 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink">Search</button>
          </form>
          <p className="mb-3 text-xs text-purity-muted dark:text-purity-mist">
            Hits the vector index over every chunk in the KB. Catalog rows without PDFs won&apos;t
            appear here yet — the open-access batch download queue fills that in.
          </p>
          <div className="max-h-[70vh] space-y-3 overflow-auto">
            {params.q && searchResults.length === 0 && (
              <EmptyState
                title="No semantic matches"
                body={<>No chunk scored above the 0.45 similarity threshold for <em>{params.q}</em>. Try broader terms.</>}
              />
            )}
            {searchResults.map((r) => (
              <article key={r.id} className="rounded-lg border border-purity-bean/10 bg-white p-3 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
                <div className="flex items-center justify-between text-xs text-purity-muted dark:text-purity-mist">
                  <span>{r.kind}{r.chapter ? ` · ch ${r.chapter}` : ''}</span>
                  <span>sim {r.similarity.toFixed(3)}</span>
                </div>
                <div className="font-medium">{r.title}</div>
                {r.heading && <div className="text-xs text-purity-muted dark:text-purity-mist">{r.heading}</div>}
                <p className="mt-1 whitespace-pre-wrap text-purity-bean/90 dark:text-purity-paper/90">{r.content.slice(0, 600)}…</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function RightsBadge({ download, hasPdf }: { download: string | null; hasPdf: boolean }) {
  const openSet = new Set(['Yes - Open Access', 'Yes - Free via PMC', 'Yes - Free access']);
  const cls = hasPdf
    ? 'bg-purity-green/10 text-purity-green dark:bg-purity-aqua/15 dark:text-purity-aqua'
    : download && openSet.has(download)
      ? 'bg-purity-green/10 text-purity-green dark:bg-purity-aqua/15 dark:text-purity-aqua'
      : download?.startsWith('No')
        ? 'bg-purity-bean/10 text-purity-muted dark:bg-purity-paper/10 dark:text-purity-mist'
        : 'bg-purity-bean/5 text-purity-muted dark:bg-purity-paper/5 dark:text-purity-mist';
  const label = hasPdf ? 'PDF ✓' : download ?? '—';
  return <span className={`inline-block rounded px-2 py-0.5 ${cls}`}>{label}</span>;
}

type SemanticHit = {
  id: string; source_id: string; heading: string | null; content: string;
  similarity: number; kind: string; title: string; chapter: string | null;
};

async function semanticSearch(q: string): Promise<SemanticHit[]> {
  const { embedOne } = await import('@/lib/voyage');
  const { supabaseAdmin } = await import('@/lib/supabase');
  const vec = await embedOne(q, 'query');
  const sb = supabaseAdmin();
  const { data } = await sb.rpc('match_chunks', {
    query_embedding: vec as unknown as string,
    match_count: 12,
    source_kinds: null,
    min_similarity: 0.45,
  });
  return (data ?? []) as SemanticHit[];
}
