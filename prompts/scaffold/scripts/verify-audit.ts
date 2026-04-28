// Smoke test for the Bioavailability Gap Detector.
// Runs three fixed prompts through /api/audit, prints a pass/fail report.
//
// Usage:
//   npm run verify-audit                              # against http://localhost:3000
//   BASE_URL=https://your.vercel.app npm run verify-audit
//   AUTH_COOKIE='sb-...' npm run verify-audit         # if auth-gated
//
// Exit code 0 if all pass, 1 otherwise — wire into CI when ready.

import 'dotenv/config';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const AUTH_COOKIE = process.env.AUTH_COOKIE ?? '';

type AuditResponse = {
  id?: string;
  draft_text?: string;
  compounds_detected?: string[];
  mechanism_engaged?: boolean;
  bioavailability_engaged?: boolean;
  evidence_engaged?: boolean;
  practical_engaged?: boolean;
  weakest_link?: string | null;
  regulatory_flags?: string[];
  evidence_tier?: number | null;
  suggested_rewrite?: string;
  cost_usd?: number;
  latency_ms?: number;
  error?: string;
  message?: string;
};

type Test = {
  name: string;
  draft: string;
  context?: string;
  expect: (r: AuditResponse) => string | null;  // null = pass, string = failure reason
};

const TESTS: Test[] = [
  {
    name: 'overclaim — disease prevention',
    draft: "Our coffee prevents Alzheimer's because it's loaded with antioxidants.",
    context: 'product_page',
    expect: (r) => {
      const flags = r.regulatory_flags ?? [];
      const hasCure = flags.some((f) => f === 'cure_word' || f === 'prevent_word' || f === 'cures_disease');
      if (!hasCure) {
        return `expected at least one of [cure_word, prevent_word, cures_disease] in regulatory_flags; got ${JSON.stringify(flags)}`;
      }
      const rewrite = (r.suggested_rewrite ?? '').toLowerCase();
      if (!/associated with|may support|research suggests|evidence indicates/.test(rewrite)) {
        return `suggested_rewrite missing hedged health-claim language: "${r.suggested_rewrite}"`;
      }
      return null;
    },
  },
  {
    name: 'bioavailability gap — CGAs to liver health',
    draft: 'PROTECT delivers higher CGAs because we roast lighter, which is why it supports liver health.',
    context: 'newsletter',
    expect: (r) => {
      const compounds = r.compounds_detected ?? [];
      if (!compounds.some((c) => /CGA/i.test(c))) {
        return `expected CGA in compounds_detected; got ${JSON.stringify(compounds)}`;
      }
      if (r.bioavailability_engaged === true) {
        return `expected bioavailability_engaged = false (claim skips Layer 2); got true`;
      }
      if (r.weakest_link !== 'bioavailability' && r.weakest_link !== 'evidence') {
        return `expected weakest_link = "bioavailability" or "evidence"; got "${r.weakest_link}"`;
      }
      return null;
    },
  },
  {
    name: 'good claim — NMP and reflux, properly hedged',
    draft: 'Trigonelline degrades during dark roasting and is converted to NMP, which research suggests may reduce gastric acid stimulation.',
    context: 'module',
    expect: (r) => {
      const flags = r.regulatory_flags ?? [];
      // This claim is well-formed; should NOT flag cure/prevent/treat words
      const badFlags = flags.filter((f) => /cure_word|prevent_word|treat_word|cures_disease/.test(f));
      if (badFlags.length > 0) {
        return `should not flag a properly-hedged claim; got ${JSON.stringify(badFlags)}`;
      }
      const compounds = r.compounds_detected ?? [];
      if (!compounds.some((c) => /trigonelline/i.test(c)) && !compounds.some((c) => /NMP/i.test(c))) {
        return `expected trigonelline or NMP in compounds_detected; got ${JSON.stringify(compounds)}`;
      }
      return null;
    },
  },
];

async function runOne(t: Test): Promise<{ pass: boolean; reason?: string; latency_ms?: number; cost_usd?: number }> {
  try {
    const res = await fetch(`${BASE_URL}/api/audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AUTH_COOKIE ? { Cookie: AUTH_COOKIE } : {}),
      },
      body: JSON.stringify({ draft: t.draft, context: t.context ?? 'other' }),
    });
    const j = (await res.json()) as AuditResponse;
    if (!res.ok) {
      return { pass: false, reason: `HTTP ${res.status}: ${j.error ?? j.message ?? 'unknown'}` };
    }
    const failure = t.expect(j);
    return failure
      ? { pass: false, reason: failure, latency_ms: j.latency_ms, cost_usd: j.cost_usd }
      : { pass: true, latency_ms: j.latency_ms, cost_usd: j.cost_usd };
  } catch (e) {
    return { pass: false, reason: `network: ${String(e)}` };
  }
}

async function main() {
  console.log(`\n→ verify-audit against ${BASE_URL}\n`);
  let passed = 0;
  let totalCost = 0;
  let totalLatency = 0;
  for (const t of TESTS) {
    process.stdout.write(`  ${t.name} ... `);
    const r = await runOne(t);
    if (r.pass) {
      passed++;
      totalCost += r.cost_usd ?? 0;
      totalLatency += r.latency_ms ?? 0;
      console.log(`✓  (${r.latency_ms ?? 0}ms, $${(r.cost_usd ?? 0).toFixed(4)})`);
    } else {
      console.log(`✗\n      ${r.reason}`);
    }
  }
  console.log(`\n  ${passed}/${TESTS.length} passed`);
  console.log(`  total: ${totalLatency}ms, $${totalCost.toFixed(4)}\n`);
  process.exit(passed === TESTS.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
