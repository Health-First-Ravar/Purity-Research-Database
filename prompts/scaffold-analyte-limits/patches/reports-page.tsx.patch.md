# Patch: `app/reports/page.tsx`

Slot the `AnalyteLimitsPanel` next to the chart so the regulatory context
sits adjacent to the data.

## Imports

Near the top, add:

```ts
import { AnalyteLimitsPanel } from './_components/AnalyteLimitsPanel';
```

## Layout — wrap chart + panel

Find the existing chart render block:

```tsx
{hasData ? (
  <div className="mb-6">
    <AnalyteChart
      rows={chartRows as Parameters<typeof AnalyteChart>[0]['rows']}
      analyteKey="__value"
      analyteLabel={analyte.label}
    />
  </div>
) : visibleCount > 0 ? (
  <p className="...">Chart needs at least 2 data points...</p>
) : null}
```

Replace with a 2-column responsive layout (chart 2/3, panel 1/3 on wide screens):

```tsx
<div className="mb-6 grid gap-4 lg:grid-cols-3">
  <div className="lg:col-span-2">
    {hasData ? (
      <AnalyteChart
        rows={chartRows as Parameters<typeof AnalyteChart>[0]['rows']}
        analyteKey="__value"
        analyteLabel={analyte.label}
        analyteKeyForLimits={analyte.key}
      />
    ) : visibleCount > 0 ? (
      <p className="text-sm text-purity-muted dark:text-purity-mist">
        Chart needs at least 2 data points for this analyte. Try a broader filter,
        another analyte, or untick "Only rows with data for this analyte" to see
        all matching rows.
      </p>
    ) : null}
  </div>
  <div className="lg:col-span-1">
    <AnalyteLimitsPanel analyteKey={analyte.key} />
  </div>
</div>
```

The `analyte.key` value is already what the URL uses (`ota_ppb`, `cga_mg_g`,
etc.), and `getAnalyteLimit()` in the data module knows how to resolve it.
For raw_values keys (`raw:lead_mg_kg`), strip the `raw:` prefix before
passing to the panel:

```tsx
const limitsKey = analyte.key.startsWith('raw:') ? analyte.key.slice(4) : analyte.key;
// pass `limitsKey` instead of `analyte.key`
```
