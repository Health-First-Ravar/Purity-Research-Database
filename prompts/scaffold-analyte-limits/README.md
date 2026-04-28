# Analyte limits — reference + Reports page integration

Compiles regulatory limits, industry benchmarks, and "why we test" context for
every analyte the Purity Lab Data system tracks today. Drops a typed lookup
into `lib/analytes/limits.ts` and a panel into the Reports page so the chart
shows the relevant threshold next to the data.

## Honest disclosures up front

- **Purity does not publicly disclose internal QC pass/fail thresholds** for
  any analyte. The Reva skill explicitly says: never fabricate Purity-specific
  lab values or compound thresholds. Every entry below either cites a public
  regulatory or industry source, or marks the field as "not publicly
  disclosed."
- **Coffee is not always called out by name** in food regulations. EU
  Regulation 2023/915 (which replaced 1881/2006 in May 2023) lists coffee
  explicitly for OTA but not for most heavy metals — coffee inherits the
  general food category limits in those cases. Where that happens, the
  reference is marked "general food category, applied to coffee."
- **Numbers stated below were accurate as of the May 2025 reference date.**
  Verify before publishing customer-facing material; EU regs in particular
  shift annually.

## Files

```
prompts/scaffold-analyte-limits/
├── README.md                                              (this)
├── analyte-limits-reference.md                            (human-readable, sources cited)
├── lib/analytes/limits.ts                                 (typed lookup, server + client safe)
├── app/reports/_components/AnalyteLimitsPanel.tsx         (server component, drop into reports page)
└── patches/
    ├── reports-page.tsx.patch.md                          (where to slot the panel)
    └── AnalyteChart.tsx.patch.md                          (reference lines on the chart)
```

## What ships

1. **Typed data module** at `lib/analytes/limits.ts` keyed by the same analyte
   strings the Reports page uses (`ota_ppb`, `cga_mg_g`, etc.). Every entry
   has: display label, unit, kind (contaminant/bioactive/qc), regulatory
   limits with source citations, industry benchmarks, Purity stance, "why we
   test" health context, and (for chart reference lines) a `chartThreshold`
   number when one exists.

2. **AnalyteLimitsPanel component** that takes the selected analyte key from
   the Reports page URL and renders the limits as a side panel: regulatory
   table, industry benchmark, Purity stance, plain-English "why this matters."

3. **Patch notes** showing where to slot the panel into the existing reports
   page layout and how to add reference lines to the existing AnalyteChart.

## Coverage

Every analyte currently in `dashboard/app/app/reports/page.tsx`'s
`TOP_ANALYTES` constant, plus the major analytes that show up under
`raw_values` (lead, cadmium, arsenic, mercury, individual pesticides like
glyphosate, PFAS sum). Anything else that appears as a raw_values key gets a
generic "no specific guideline mapped — see reference sheet" treatment.
