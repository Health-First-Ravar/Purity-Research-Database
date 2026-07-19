import { cookies } from 'next/headers';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';
import { hasElevatedAccess } from '@/lib/auth-roles';
import { bucketOf, suggestFor, BLEND_KEYS, type UnassignedCoa } from '@/lib/coa-assign';
import { AssignClient, type BucketView } from './_components/AssignClient';

export const dynamic = 'force-dynamic';

/**
 * Product assignment queue.
 *
 * 204 COAs carry no product association, which is what makes trend questions
 * unanswerable. The association is not derivable from the COA — it lives in
 * purchasing records — so this page exists to make the human decision fast, not
 * to make it automatically. Nothing here assigns anything on its own.
 */
export default async function AssignPage() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return <p className="text-sm text-purity-muted">Sign in to review assignments.</p>;
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) {
    return <p className="text-sm text-purity-rust">Editor role required.</p>;
  }

  const { data: unassigned } = await supabase
    .from('coas')
    .select('id, report_number, coffee_name, lot_number, origin, matrix, lab, report_date, pdf_filename')
    .eq('product_scope', 'unclassified')
    .is('retired_at', null)
    .order('report_date', { ascending: false })
    .limit(1000);

  // Already-assigned rows, used only for the sibling-lot suggestion.
  const { data: assigned } = await supabase
    .from('coas')
    .select('lot_number, origin, coffee_name, blend')
    .not('blend', 'is', null)
    .is('retired_at', null)
    .limit(1000);
  const siblings = (assigned ?? []).filter((s): s is typeof s & { blend: string } => !!s.blend);

  const rows = (unassigned ?? []) as UnassignedCoa[];
  const byBucket = new Map<string, BucketView['records']>();
  for (const r of rows) {
    const b = bucketOf(r);
    const s = suggestFor(r, siblings);
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b)!.push({
      id: r.id,
      reportNumber: r.report_number,
      coffeeName: r.coffee_name,
      lotNumber: r.lot_number,
      origin: r.origin,
      matrix: r.matrix,
      lab: r.lab,
      reportDate: r.report_date,
      pdfFilename: r.pdf_filename,
      suggestedBlend: s.blend,
      suggestionEvidence: s.evidence,
      suggestionStrength: s.strength,
    });
  }

  const buckets: BucketView[] = [...byBucket.entries()]
    .map(([name, records]) => ({ name, records }))
    .sort((a, b) => b.records.length - a.records.length);

  const total = rows.length;
  const withSuggestion = buckets.reduce(
    (n, b) => n + b.records.filter((r) => r.suggestedBlend).length, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl">Assign products to COAs</h1>
        <Link href="/reports" className="text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">
          ← Reports
        </Link>
      </div>

      <p className="mb-3 max-w-3xl text-sm text-purity-muted dark:text-purity-mist">
        {total} COAs have no product association, grouped into {buckets.length} buckets by
        producer or origin. Assigning a product makes a record visible to customer service, so
        every assignment is recorded against your account and can be reverted.
      </p>

      <div className="mb-6 max-w-3xl rounded-md border border-purity-bean/10 bg-purity-cream/50 p-3 text-xs dark:border-purity-paper/10 dark:bg-purity-shade/50">
        <p className="font-semibold">How to use this</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-purity-bean dark:text-purity-paper">
          <li>Work a bucket at a time. Where a whole bucket is one product, assign it in one action.</li>
          <li>
            Suggestions are <strong>proposals only</strong>, shown with their evidence. Nothing is
            applied until you confirm. A suggestion is never a reason on its own.
          </li>
          <li>
            Skip anything you are unsure of. A skip is recorded, so the next person knows it was
            looked at rather than missed.
          </li>
          <li>
            {withSuggestion} of {total} records have any evidence-backed suggestion. The rest need
            the source PDF opened.
          </li>
        </ul>
      </div>

      <AssignClient buckets={buckets} blendKeys={BLEND_KEYS} />
    </div>
  );
}
