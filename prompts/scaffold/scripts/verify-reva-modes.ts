// Smoke test for Ask Reva operator chat — runs the same question across
// all three modes (CREATE / ANALYZE / CHALLENGE) and prints a comparison
// of cited-chunk source-kind balance + flags.
//
// The point of this test isn't to assert specific answers (those vary turn
// to turn). It's to verify the retrieval-weight shift IS happening:
//   create   should pull more from purity_brain + reva_skill
//   analyze  should pull mostly from research_paper + coffee_book
//   challenge should pull almost entirely from research_paper + coffee_book
//
// Usage:
//   SESSION_ID=<uuid> npm run verify-reva-modes
//   BASE_URL=https://your.vercel.app SESSION_ID=<uuid> AUTH_COOKIE='sb-...' npm run verify-reva-modes

import 'dotenv/config';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const AUTH_COOKIE = process.env.AUTH_COOKIE ?? '';
const SESSION_ID = process.env.SESSION_ID;

if (!SESSION_ID) {
  console.error('SESSION_ID env var required (a real reva_session uuid for the editor account).');
  process.exit(1);
}

const QUESTION = 'How should we talk about chlorogenic acids and liver health in a customer-facing newsletter?';
const MODES = ['create', 'analyze', 'challenge'] as const;
type Mode = (typeof MODES)[number];

type RevaResponse = {
  message_id?: string;
  answer?: string;
  mode?: string;
  cited_chunks?: { id: string; kind: string; title: string; chapter: string | null }[];
  flags?: { left_evidence?: boolean; regulatory_risk?: boolean; weakest_link?: string | null };
  cost_usd?: number;
  latency_ms?: number;
  error?: string;
  message?: string;
};

async function runMode(mode: Mode): Promise<RevaResponse> {
  const res = await fetch(`${BASE_URL}/api/reva`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_COOKIE ? { Cookie: AUTH_COOKIE } : {}),
    },
    body: JSON.stringify({ session_id: SESSION_ID, mode, question: QUESTION, prior: [] }),
  });
  const j = (await res.json()) as RevaResponse;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for mode=${mode}: ${j.error ?? j.message ?? 'unknown'}`);
  }
  return j;
}

function balance(cited: RevaResponse['cited_chunks']): { brand: number; evidence: number; other: number } {
  const out = { brand: 0, evidence: 0, other: 0 };
  for (const c of cited ?? []) {
    if (c.kind === 'purity_brain' || c.kind === 'reva_skill') out.brand++;
    else if (c.kind === 'research_paper' || c.kind === 'coffee_book') out.evidence++;
    else out.other++;
  }
  return out;
}

async function main() {
  console.log(`\n→ verify-reva-modes against ${BASE_URL}`);
  console.log(`  session: ${SESSION_ID}`);
  console.log(`  question: "${QUESTION}"\n`);

  const results: Record<Mode, RevaResponse> = {} as Record<Mode, RevaResponse>;
  for (const m of MODES) {
    process.stdout.write(`  running ${m} ... `);
    try {
      results[m] = await runMode(m);
      console.log(`✓ ${results[m].latency_ms ?? 0}ms, $${(results[m].cost_usd ?? 0).toFixed(4)}`);
    } catch (e) {
      console.log(`✗ ${String(e)}`);
      process.exit(1);
    }
  }

  console.log(`\n  cited-chunk source balance per mode:`);
  console.log(`  ────────────────────────────────────────────────────────`);
  console.log(`  mode       brand   evidence   flags                    `);
  console.log(`  ────────────────────────────────────────────────────────`);
  let allShifted = true;
  let lastBrandShare = 1;
  for (const m of MODES) {
    const b = balance(results[m].cited_chunks);
    const total = b.brand + b.evidence + b.other || 1;
    const brandShare = b.brand / total;
    const f = results[m].flags ?? {};
    const flagStr = [
      f.left_evidence ? 'left_evidence' : '',
      f.regulatory_risk ? 'regulatory_risk' : '',
      f.weakest_link ? `weak:${f.weakest_link}` : '',
    ].filter(Boolean).join(' ') || 'none';
    console.log(`  ${m.padEnd(10)} ${String(b.brand).padStart(5)}   ${String(b.evidence).padStart(8)}   ${flagStr}`);
    if (brandShare > lastBrandShare + 0.05) allShifted = false;
    lastBrandShare = brandShare;
  }
  console.log(`  ────────────────────────────────────────────────────────\n`);

  console.log(`  expectation: brand share should DECREASE moving create → analyze → challenge`);
  console.log(`  result: ${allShifted ? '✓ retrieval weights are shifting as expected' : '✗ weights are not shifting; check retrieveWeighted()'}\n`);

  console.log(`  answer previews (first 200 chars):`);
  for (const m of MODES) {
    const a = (results[m].answer ?? '').slice(0, 200).replace(/\s+/g, ' ');
    console.log(`\n  [${m}] ${a}${a.length === 200 ? '…' : ''}`);
  }
  console.log();

  process.exit(allShifted ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
