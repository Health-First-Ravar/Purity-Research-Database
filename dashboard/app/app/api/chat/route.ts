// POST /api/chat
// Body: { question: string; session_id: string; prior?: {role, content}[] }
// Runs: classify → canon-cache lookup → retrieve chunks → generate → log message.
// Escalates when insufficient_evidence=true OR confidence_score < 0.55.
//
// Session context is session-scoped: the client passes the last 2-3 turns.
// No cross-session threading.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { classify } from '@/lib/rag/classify';
import { findCanonHit, retrieveChunks } from '@/lib/rag/retrieve';
import { generateAnswer, type PriorTurn } from '@/lib/rag/generate';
import { embedOne } from '@/lib/voyage';
import { checkChatRateLimit } from '@/lib/rate-limit';

// Floor below which we treat the answer as a real failure regardless of what
// the model says. Above this, trust the model's escalation_recommended signal.
const HARD_CONFIDENCE_FLOOR = 0.30;

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const question: string = (body.question ?? '').trim();
  const session_id: string = body.session_id;
  const priorRaw: PriorTurn[] = Array.isArray(body.prior) ? body.prior : [];
  const prior = priorRaw.slice(-3); // cap at last 3 turns

  if (!question || !session_id) {
    return NextResponse.json({ error: 'question and session_id required' }, { status: 400 });
  }

  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Rate limit: per-user per-minute + per-day bucket.
  const rate = await checkChatRateLimit(supabase);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: 'rate_limit_exceeded',
        reason: rate.reason,
        retry_after_seconds: rate.retry_after_seconds,
        rpm_remaining: rate.rpm_remaining,
        rpd_remaining: rate.rpd_remaining,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rate.retry_after_seconds),
          'X-RateLimit-Remaining-Minute': String(rate.rpm_remaining),
          'X-RateLimit-Remaining-Day': String(rate.rpd_remaining),
        },
      },
    );
  }

  // 1. Classify
  const cls = await classify(question);

  // 2. Canon-cache check (skipped when classification says fresh required)
  const canon = await findCanonHit(supabase, question, cls);

  if (canon) {
    // Increment hit count (best-effort, no blocking)
    void supabase
      .from('canon_qa')
      .update({ hit_count: ((canon as { hit_count?: number }).hit_count ?? 0) + 1 })
      .eq('id', canon.id)
      .then(
        () => {},
        (e) => console.error('[canon hit-count]', e),
      );

    const latency_ms = Date.now() - t0;

    const { data: insertedCanon } = await supabase
      .from('messages')
      .insert({
        session_id,
        user_id: auth.user.id,
        question,
        answer: canon.answer,
        canon_hit_id: canon.id,
        retrieved_chunk_ids: [],
        cited_chunk_ids: [],
        confidence_score: 1.0,
        insufficient_evidence: false,
        escalated: false,
        classification: cls.category,
        latency_ms,
      })
      .select('id')
      .single();

    return NextResponse.json({
      message_id: insertedCanon?.id,
      answer: canon.answer,
      source: 'canon',
      canon_id: canon.id,
      confidence_score: 1.0,
      freshness_tier: canon.freshness_tier,
      next_review_due: canon.next_review_due,
      escalated: false,
    });
  }

  // 3. Retrieve
  const chunks = await retrieveChunks(supabase, question, cls);

  // 4. Generate
  const result = await generateAnswer({ question, chunks, classification: cls, prior });
  const latency_ms = Date.now() - t0;

  // Decide whether to escalate.
  // Trust the model's structured signal first; fall back to floors for failures.
  // - Hard floor (< 0.30 confidence): always escalate; model is genuinely lost.
  // - Model-recommended escalation: trust it. This is how serious-medical and
  //   contradictory-evidence cases reach the editor queue.
  // - insufficient_evidence ALONE no longer escalates — the new prompt only sets
  //   it for genuinely-unanswerable customer-asked specifics. We still escalate
  //   when the question is COA / batch / time-sensitive AND evidence was missing.
  let escalated = false;
  let escalation_reason: string | null = null;
  if (result.confidence_score < HARD_CONFIDENCE_FLOOR) {
    escalated = true;
    escalation_reason = 'low_confidence';
  } else if (result.escalation_recommended) {
    escalated = true;
    escalation_reason = result.escalation_reason ?? 'model_flagged';
  } else if (
    result.insufficient_evidence
    && (cls.category === 'coa' || cls.requires_fresh)
  ) {
    escalated = true;
    escalation_reason = 'specific_data_missing';
  }

  const { data: inserted } = await supabase
    .from('messages')
    .insert({
      session_id,
      user_id: auth.user.id,
      question,
      answer: result.answer,
      canon_hit_id: null,
      retrieved_chunk_ids: chunks.map((c) => c.id),
      cited_chunk_ids: result.cited_chunk_ids,
      confidence_score: result.confidence_score,
      insufficient_evidence: result.insufficient_evidence,
      escalated,
      escalation_reason,
      classification: cls.category,
      latency_ms,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      cost_usd: result.cost_usd,
    })
    .select('id')
    .single();

  // Topic tagging — best-effort; never fail the chat response on this.
  if (cls.topic_slugs?.length && inserted?.id) {
    try {
      const adb = supabaseAdmin();
      const { data: topicRows } = await adb
        .from('question_topics')
        .select('id, slug')
        .in('slug', cls.topic_slugs);
      const tagRows = (topicRows ?? []).map((t) => ({
        message_id: inserted.id,
        topic_id: t.id,
        confidence: 0.8,
        source: 'auto' as const,
      }));
      if (tagRows.length) {
        await adb.from('message_topics').upsert(tagRows, { onConflict: 'message_id,topic_id' });
      }
    } catch (e) {
      console.error('topic tagging failed:', e);
    }
  }

  return NextResponse.json({
    message_id: inserted?.id,
    answer: result.answer,
    source: 'llm',
    confidence_score: result.confidence_score,
    insufficient_evidence: result.insufficient_evidence,
    escalated,
    escalation_reason,
    cited_chunks: chunks
      .filter((c) => result.cited_chunk_ids.includes(c.id))
      .map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        chapter: c.chapter,
        similarity: c.similarity,
      })),
  });
}

// Embed-and-search helper exposed for the debug page; no-op externally.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });
  const vec = await embedOne(q, 'query');
  return NextResponse.json({ dims: vec.length });
}
