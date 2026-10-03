// Green lots (staff only; RLS also withholds these rows from customer service).
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { analyteLabel, analyteStatus, display, recordLabel } from '@/lib/lab-status';
import { getHubRole, isStaffRole, loadLab, niceDate } from '@/lib/lab-data';
import { Card, coaSubNav, SubNav, TrackerNote } from '../../_components/hub';
import { StatusCell, StatusChip } from '../../_components/StatusChip';

export const dynamic = 'force-dynamic';
const KEY = ['OTA', 'AFB1', 'DON', 'Pb', 'Cd', 'As', 'Hg', 'CGA', 'CAF', 'MOI', 'AW'];

export default async function GreenLotsPage() {
  const sb = supabaseServer(await cookies());
  const { userId, role } = await getHubRole(sb);
  if (!userId) redirect('/login?next=/coa/green');
  if (!isStaffRole(role)) redirect('/coa');
  const { recs, std, syncedAt } = await loadLab(sb);
  const green = recs.filter((r) => r.kind === 'green');
  return (
    <div>
      <SubNav items={coaSubNav(true)} current="/coa/green" />
      <Card title="Green lots" hint={`Scored against Green Arabica Requirements v2.5. ${green.length} green results, newest first.`}>
        <div className="hub-table max-h-[720px]">
          <table>
            <thead><tr><th>Date</th><th>Lot</th><th>Status</th><th>Key results</th><th>Certificate</th></tr></thead>
            <tbody>
              {green.map((r) => {
                const rl = recordLabel(r, std);
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{niceDate(r.test_date)}</td>
                    <td>{r.name}<div className="text-xs text-purity-muted dark:text-purity-mist">{r.lab}</div></td>
                    <td><StatusChip status={rl.status} label={rl.label} /></td>
                    <td className="text-xs">
                      {KEY.filter((c) => r.analytes?.[c]).map((c) => {
                        const a = analyteStatus(r, c, std)!;
                        return <span key={c} className="m-0.5 inline-block"><StatusCell status={a.status} title={analyteLabel(a)}>{c} {display(a.reading)}</StatusCell></span>;
                      })}
                    </td>
                    <td className="text-sm">{r.certificate_url ? <a className="text-purity-teal underline dark:text-purity-glow" href={r.certificate_url} target="_blank" rel="noopener noreferrer">Certificate</a> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <TrackerNote syncedAt={syncedAt} />
    </div>
  );
}
