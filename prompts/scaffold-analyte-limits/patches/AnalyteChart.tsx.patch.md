# Patch: `app/reports/_components/AnalyteChart.tsx`

Add an optional `analyteKeyForLimits` prop. When the matching analyte has a
`chartThreshold`, draw a horizontal reference line at that value with a
small label — so the chart shows "you are X distance from the regulatory
limit" visually.

## Imports

Add (recharts is already imported):

```ts
import { ReferenceLine } from 'recharts';
import { getAnalyteLimit } from '@/lib/analytes/limits';
```

## Props

Extend the existing props interface:

```ts
type Props = {
  rows: Row[];
  analyteKey: string;       // existing — column key on the row data
  analyteLabel: string;     // existing — chart title / Y axis label
  analyteKeyForLimits?: string;  // NEW — limits.ts lookup key (often the analyte filter key)
};
```

## Render

Inside the recharts `<LineChart>` (or `<ComposedChart>`), add a `<ReferenceLine>`
when a threshold exists:

```tsx
{(() => {
  const lookupKey = (analyteKeyForLimits ?? '').startsWith('raw:')
    ? analyteKeyForLimits!.slice(4)
    : analyteKeyForLimits;
  const limit = lookupKey ? getAnalyteLimit(lookupKey) : null;
  if (!limit?.chartThreshold) return null;
  return (
    <ReferenceLine
      y={limit.chartThreshold}
      stroke="#B04A2E"           /* purity-rust */
      strokeDasharray="4 4"
      strokeWidth={1.5}
      label={{
        value: `${limit.chartThresholdLabel ?? 'limit'}: ${limit.chartThreshold}`,
        position: 'right',
        fill: '#B04A2E',
        fontSize: 10,
      }}
    />
  );
})()}
```

For bioactives (no `chartThreshold`), the line is skipped. For contaminants
with a regulatory limit, the line shows in rust-red dashed — instantly
visible "above the line = problem; below = healthy."

## Optional: zone shading

For analytes where the relevant signal is "stay well below the line" (OTA,
acrylamide, lead), you can add a translucent rust-tinted area between
the threshold and the chart top to make the danger zone visible. Skip
unless you want the extra visual weight.
