// The claim auditor moved to Claims > Check a claim (Research Hub overhaul).
import { redirect } from 'next/navigation';

export default function AuditPage() {
  redirect('/claims/check');
}
