'use client';

// Result card. Layer indicator (4 dots), compound chips, flags, evidence tier,
// suggested rewrite (copyable), cited chunks (collapsible).

import { useState } from 'react';

export type AuditResponse = {
  id: string;
  draft_text: string;
  context: string;
  compounds_detected: string[];
  mechanism_engaged: boolean;
  bioavailability_engaged: boolean;
  evidence_engaged: boolean;
  practical_engaged: boolean;
  weakest_link: 'mechanism' | 'bioavailability' | 'evidence' | 'practical' | null;
  regulatory_flags: string[];
  evidence_tier: number | null;
  suggested_rewrite: string;
  reasoning: string;
  cited_chunks: {
    id: string;
    title: string;
    kind: string;
    chapter: string | null;
    heading: string | null;
    content: string;
    similarity: number;
  }[];
  cost_usd: number;
  latency_ms: number;
};

const LAYERS: Array<{
  key: 'mechanism' | 'bioavailability' | 'evidence' | 'practical';
  label: string;
  hint: string;
}> = [
  { key: 'mechanism',       label: 'Mechanism',       hint: 'biological pathway / receptor' },
  { key: 'bioavailability', label: 'Bioavailability', hint: 'survives digestion + absorption' },
  { key: 'evidence',        label: 'Evidence',        hint: 'study type + effect size' },
  { key: 'practical',       label: 'Practical',       hint: 'what can be claimed' },
];

const TIER_LABEL: Record<number, string> = {
  1: 'pre-registered RCT',
  2: 'systematic review / meta-analysis',
  3: 'prospective cohort',
  4: 'cross-sectional / retrospective',
  5: 'mechanistic human (PK / bioavailability)',
  6: 'animal',
  7: 'in vitro / cell culture',
};

export function AuditResult({ result }: { result: AuditResponse }) {
  const [showCites, setShowCites] = useState(false);
  const [copied, setCopied] = useState(false);

  const engaged: Record<string, boolean> = {
    mechanism: result.mechanism_engaged,
    bioavailability: result.bioavailability_engaged,
    evidence: result.evidence_engaged,
    practical: result.practical_engaged,
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
        <div className="mb-3 text-xs uppercase tracking-wide text-purity-muted dark:text-purity-mist">
          Compound Reasoning Stack
        </div>
        <ol className="space-y-2">
          {LAYERS.map((l) => {
            const on = engaged[l.key];
            const weak = result.weakest_link === l.key;
            return (
              <li key={l.key} className="flex items-start gap-3">
                <span
                  className={
                    'mt-1 inline-block h-3 w-3 shrink-0 rounded-full border ' +
                    (on
                      ? 'border-purity-green bg-purity-green dark:border-purity-aqua dark:bg-purity-aqua'
                      : 'border-purity-bean/30 bg-transparent dark:border-purity-paper/30')
                  }
                  aria-label={on ? 'engaged' : 'not engaged'}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {l.label}
                    {weak && (
                      <span className="rounded bg-purity-rust/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-purity-rust">
                        weakest link
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-purity-muted dark:text-purity-mist">{l.hint}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-purity-muted dark:text-purity-mist">Compounds</span>
          {result.compounds_detected.length === 0 ? (
            <span className="text-xs text-purity-muted dark:text-purity-mist">none detected</span>
          ) : (
            result.compounds_detected.map((c) => (
              <span
                key={c}
                className="rounded bg-purity-aqua/15 px-2 py-0.5 text-[11px] text-purity-green dark:text-purity-aqua"
              >
                {c}
              </span>
            ))
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-purity-muted dark:text-purity-mist">Regulatory</span>
          {result.regulatory_flags.length === 0 ? (
            <span className="text-xs text-purity-muted dark:text-purity-mist">no flags</span>
          ) : (
            result.regulatory_flags.map((f) => (
              <span key={f} className="rounded bg-purity-rust/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-purity-rust">
                {f.replace(/_/g, ' ')}
              </span>
            ))
          )}
        </div>

        {result.evidence_tier && (
          <div className="mt-3 text-xs text-purity-muted dark:text-purity-mist">
            <span className="uppercase tracking-wide">Evidence tier:</span>{' '}
            <span className="font-medium text-purity-bean dark:text-purity-paper">
              {result.evidence_tier} — {TIER_LABEL[result.evidence_tier]}
            </span>
          </div>
        )}
      </div>

      {result.suggested_rewrite && (
        <div className="rounded-lg border border-purity-green/30 bg-purity-green/5 p-4 dark:border-purity-aqua/30 dark:bg-purity-aqua/10">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-purity-green dark:text-purity-aqua">
              Reva&apos;s reconstructed claim
            </span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(result.suggested_rewrite);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded border border-purity-green/40 px-2 py-0.5 text-[11px] text-purity-green hover:bg-purity-green/10 dark:border-purity-aqua/40 dark:text-purity-aqua dark:hover:bg-purity-aqua/10"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-sm text-purity-bean dark:text-purity-paper">{result.suggested_rewrite}</p>
        </div>
      )}

      <div className="rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
        <button
          type="button"
          onClick={() => setShowCites((v) => !v)}
          className="flex w-full items-center justify-between text-xs uppercase tracking-wide text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua"
        >
          <span>Cited evidence ({result.cited_chunks.length})</span>
          <span>{showCites ? '−' : '+'}</span>
        </button>
        {showCites && (
          <ul className="mt-3 space-y-3">
            {result.cited_chunks.map((c) => (
              <li key={c.id} className="rounded border border-purity-bean/10 bg-purity-cream/40 p-3 text-xs dark:border-purity-paper/10 dark:bg-purity-ink/40">
                <div className="flex items-center justify-between text-[11px] text-purity-muted dark:text-purity-mist">
                  <span>
                    {c.kind}
                    {c.chapter ? ` · ch ${c.chapter}` : ''}
                  </span>
                  <span>sim {c.similarity.toFixed(3)}</span>
                </div>
                <div className="font-medium text-purity-bean dark:text-purity-paper">{c.title}</div>
                {c.heading && <div className="text-[11px] text-purity-muted dark:text-purity-mist">{c.heading}</div>}
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-purity-bean/90 dark:text-purity-paper/90">
                  {c.content.slice(0, 500)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 text-[11px] text-purity-muted dark:text-purity-mist">
          {(result.cost_usd * 100).toFixed(2)}¢ · {result.latency_ms} ms
        </div>
      </div>
    </div>
  );
}
