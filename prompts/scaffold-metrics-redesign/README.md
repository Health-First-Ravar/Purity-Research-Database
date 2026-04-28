# Metrics page redesign

Replaces `dashboard/app/app/metrics/page.tsx` and adds three small client
components. Reads the same `daily_chat_metrics` view + the same counts
queries — no backend changes needed. Just clearer presentation.

## Files

```
prompts/scaffold-metrics-redesign/
├── README.md
├── app/metrics/page.tsx                          → REPLACES the live page
├── app/metrics/_components/ActivityChart.tsx     → recharts stacked bars
├── app/metrics/_components/Explainer.tsx         → plain-English definitions
└── app/metrics/_components/EngineeringDetails.tsx → collapsible old table
```

## What changes

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Dashboard                                                    │
│  One-line summary in serif: "Over the last 30 days, the chat │
│  helped X people. Y answers needed Jeremy or Ildi to step in."│
│                                                       [window] │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │ Conversations │ │  Answered     │ │  Customer     │   THREE  │
│  │     10        │ │  Confidently  │ │  Satisfaction │   PRIMARY │
│  │  this month   │ │     20%   ⚠  │ │   no data yet │   KPIs    │
│  └──────────────┘ └──────────────┘ └──────────────┘          │
│                                                                │
│  Activity over time (stacked bar chart, by day)                │
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     │
│   green = answered in chat · amber = sent to a person         │
│                                                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐              │
│  │ AI cost │ │  Speed  │ │ Quick   │ │ Waiting │   FOUR        │
│  │ $0.14   │ │  9.2s   │ │ answers │ │ on a    │   HEALTH      │
│  │ this    │ │ avg     │ │ ready   │ │ person  │   STATS       │
│  │ period  │ │         │ │ 0       │ │ 8       │               │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘              │
│                                                                │
│  ▼ What these numbers mean (collapsible explainer)             │
│                                                                │
│  ▼ Engineering details (collapsible — old table lives here)    │
└──────────────────────────────────────────────────────────────┘
```

### Language map (jargon → plain)

| Old label             | New label                  |
|-----------------------|----------------------------|
| Messages              | Conversations              |
| Canon-hit rate        | Quick answers ready        |
| Escalation rate       | Sent to a person           |
| Thumbs-up rate        | Customer satisfaction      |
| Cost (USD)            | AI cost this period        |
| Open escalations      | Waiting on a person        |
| Promotion candidates  | Good answers to save       |
| Canon misses          | Answers that need work     |
| p50 latency / p95 ms  | (hidden under "Engineering details") |
| Avg conf              | (also hidden)              |

### Status semantics

Each primary tile gets a status dot:
  * green ✓ — healthy
  * amber ⚠ — watch this
  * red ✕ — needs attention

Thresholds (tunable in `STATUS_RULES` constant):
  * Sent-to-a-person rate (escalation): ≤25% green, 26–50% amber, >50% red
  * Customer satisfaction: ≥80% green, 60–79% amber, <60% red, "no data yet" neutral
  * Quick answers ready (canon hit): ≥30% green, 10–29% amber, <10% neutral (early-system)
  * Speed: ≤4s green, 4–8s amber, >8s red

### What the chart shows

Last 30 days, one stacked bar per day:
  * green segment = answered in chat (not escalated)
  * amber segment = sent to a person (escalated)
  * thumbs-up dots overlaid where rating data exists

This is the single visual that tells the "is the system getting better?" story.

## To ship

1. Replace `app/metrics/page.tsx` with the file in this folder
2. Drop the three new components into `app/metrics/_components/`
3. `npm run lint && npm run build`
4. Visit `/metrics` — should see the new layout

The old daily-breakdown table is preserved verbatim inside the
"Engineering details" accordion, so nothing is lost for power users.
