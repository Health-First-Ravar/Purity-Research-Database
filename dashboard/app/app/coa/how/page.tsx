// How we test: a customer-safe summary of Brian's testing SOP.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { getHubRole, isStaffRole } from '@/lib/lab-data';
import { Card, coaSubNav, SubNav } from '../../_components/hub';

export const dynamic = 'force-dynamic';

const WHEN = [
  ['Every new green lot', 'Pre-shipment sample from the dry mill', 'Mycotoxin panel, moisture, water activity, grading'],
  ['New producer partner', 'Pre-shipment green', 'Full green panel plus health compounds'],
  ['Annual finished-product COA', 'Sealed retail bag from the co-packer', 'Finished contaminants and nutrition'],
  ['New product or format', 'First production run', 'Finished contaminants and nutrition'],
  ['Roaster or co-packer change', 'First production run', 'Finished contaminants, metals required'],
  ['Out of spec or complaint', 'Retained sample and a new sealed bag', 'Repeat the failed analyte'],
];
const PANELS = [
  ['Finished contaminants', 'Heavy metals, mycotoxins, acrylamide, yeast and mold, 500+ pesticide screen, glyphosate and AMPA, 2-phenylphenol, gluten'],
  ['Finished nutrition', 'Chlorogenic acids, caffeine, minerals, vitamins, organic acids'],
  ['Green lot', 'Aflatoxins, ochratoxin A, DON, fumonisins, T-2/HT-2, zearalenone, moisture, water activity'],
  ['Micro', 'Yeast and mold plate count, aerobic plate count'],
];

export default async function HowWeTestPage() {
  const sb = supabaseServer(await cookies());
  const { userId, role } = await getHubRole(sb);
  if (!userId) redirect('/login?next=/coa/how');
  return (
    <div>
      <SubNav items={coaSubNav(isStaffRole(role))} current="/coa/how" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="When we test" hint="Summarized from Brian's testing SOP.">
          <div className="hub-table"><table>
            <thead><tr><th>Trigger</th><th>Sample</th><th>Panel</th></tr></thead>
            <tbody>{WHEN.map((r) => <tr key={r[0]}><td className="font-semibold">{r[0]}</td><td className="text-sm">{r[1]}</td><td className="text-sm">{r[2]}</td></tr>)}</tbody>
          </table></div>
        </Card>
        <Card title="What each panel covers" hint="Results are scored against the Health Grade standard.">
          <div className="hub-table"><table>
            <thead><tr><th>Panel</th><th>Analytes</th></tr></thead>
            <tbody>{PANELS.map((r) => <tr key={r[0]}><td className="font-semibold">{r[0]}</td><td className="text-sm">{r[1]}</td></tr>)}</tbody>
          </table></div>
          <p className="mt-3 rounded-lg bg-purity-soft p-3 text-sm dark:bg-purity-night">
            Say it this way: every green lot is tested for mycotoxins before roasting, and each blend gets a full contaminant panel at an independent lab once a year. Not &quot;every batch&quot;.
          </p>
        </Card>
      </div>
    </div>
  );
}
