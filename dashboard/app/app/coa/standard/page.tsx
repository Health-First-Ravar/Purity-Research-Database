// The Health Grade standard every result is scored against (copied from
// Brian's tracker until it stores the standard itself).
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { getHubRole, isStaffRole, loadLab } from '@/lib/lab-data';
import type { StdRow } from '@/lib/lab-status';
import { Card, coaSubNav, SubNav } from '../../_components/hub';

export const dynamic = 'force-dynamic';

function ruleText(r?: StdRow) {
  if (!r) return '';
  if (r.rule === 'not_detectable') return 'Not detectable';
  if (r.rule === 'flag_detected') return 'Flagged when detected';
  if (r.rule === 'informational') return 'Informational';
  if (r.rule === 'floor') return `≥ ${r.value} ${r.unit}${r.required ? '' : ' (target)'}`;
  return `${r.applies_to === 'green' ? '<' : '≤'} ${r.value} ${r.unit}`;
}

export default async function StandardPage() {
  const sb = supabaseServer(await cookies());
  const { userId, role } = await getHubRole(sb);
  if (!userId) redirect('/login?next=/coa/standard');
  const { std } = await loadLab(sb);
  const codes = Object.keys(std.finished).filter((c) => std.finished[c].rule !== 'informational' || std.green[c]);
  const versions = [...new Set([...Object.values(std.finished), ...Object.values(std.green)].map((r) => r.version).filter(Boolean))];
  return (
    <div>
      <SubNav items={coaSubNav(isStaffRole(role))} current="/coa/standard" />
      <Card title="Health Grade standard" hint="The limits every result is scored against. Near limit means above 80% of a limit; LOQ above limit means the lab's reporting limit sits above ours.">
        <div className="hub-table">
          <table>
            <thead><tr><th>Analyte</th><th>Group</th><th>Finished product</th><th>Green coffee (v2.5)</th></tr></thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c}>
                  <td>{std.finished[c].label}{std.finished[c].roasted_only ? <span className="text-xs text-purity-muted"> · roasted only</span> : null}</td>
                  <td className="text-sm text-purity-muted dark:text-purity-mist">{std.finished[c].grp}</td>
                  <td className="tabular-nums">{ruleText(std.finished[c])}</td>
                  <td className="tabular-nums">{ruleText(std.green[c])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-purity-muted dark:text-purity-mist">Sources: {versions.join(' · ')}.</p>
      </Card>
    </div>
  );
}
