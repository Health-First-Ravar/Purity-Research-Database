import { LABEL, type Status } from '@/lib/lab-status';

/** Brian's status chip. `label` overrides the default word (e.g. "Below minimum"). */
export function StatusChip({ status, label }: { status: Status; label?: string }) {
  return <span className={`st st-${status}`}>{label ?? LABEL[status]}</span>;
}

/** A value shown inside a colored cell, as in Brian's product-by-analyte matrix. */
export function StatusCell({ status, children, title }: { status: Status; children: React.ReactNode; title?: string }) {
  return <span className={`st-cell st-${status}`} title={title}>{children}</span>;
}
