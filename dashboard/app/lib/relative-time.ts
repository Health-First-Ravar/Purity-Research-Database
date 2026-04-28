// Tiny relative-time formatter. Returns "just now", "3 min ago", "2 h ago",
// "yesterday", "3 d ago", or falls back to a locale date for anything older
// than a week. Used in the editor queue + escalation timeline where precise
// timestamps add noise without value.

const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl
  ? new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })
  : null;

export function relativeTime(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diffMs = d.getTime() - now;            // negative for past
  const absSec = Math.abs(diffMs) / 1000;

  if (absSec < 30) return 'just now';

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60 * 60],
    ['hour',   60 * 60 * 24],
    ['day',    60 * 60 * 24 * 7],
  ];

  for (const [unit, threshold] of units) {
    if (absSec < threshold) {
      const divisor =
        unit === 'second' ? 1 :
        unit === 'minute' ? 60 :
        unit === 'hour'   ? 3600 :
        86400;
      const value = Math.round(diffMs / 1000 / divisor);
      if (rtf) return rtf.format(value, unit);
      const abs = Math.abs(value);
      return `${abs} ${unit}${abs === 1 ? '' : 's'} ${value < 0 ? 'ago' : 'from now'}`;
    }
  }

  // Older than a week: show a short locale date.
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Precise tooltip companion — full timestamp for on-hover title attribute.
export function absoluteTime(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}
