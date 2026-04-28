// Thin wrapper over the Anthropic SDK with the two model aliases we use.
// Generation: Sonnet 4.6 (primary). Classification/tagging: Haiku 4.5.

import Anthropic from '@anthropic-ai/sdk';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const MODEL_GENERATE = process.env.ANTHROPIC_MODEL_GENERATE ?? 'claude-sonnet-4-6';
export const MODEL_CLASSIFY = process.env.ANTHROPIC_MODEL_CLASSIFY ?? 'claude-haiku-4-5-20251001';

// Structured output shape the chat pipeline expects back from Sonnet.
export type GenerateResult = {
  answer: string;
  confidence_score: number;         // 0..1
  cited_chunk_ids: string[];
  insufficient_evidence: boolean;
  escalation_recommended: boolean;  // model's own judgement (smarter than confidence floor)
  escalation_reason: string | null; // short tag — 'specific_lot_value', 'serious_medical', etc.
  reasoning?: string;               // kept out of user-facing UI; logged
};

export function parseGenerateResult(raw: string): GenerateResult {
  // Sonnet returns JSON in the final content block. Tolerate stray prose.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      answer: raw.trim(),
      confidence_score: 0,
      cited_chunk_ids: [],
      insufficient_evidence: true,
      escalation_recommended: false,
      escalation_reason: null,
    };
  }
  try {
    const j = JSON.parse(match[0]);
    return {
      answer: String(j.answer ?? ''),
      confidence_score: Number(j.confidence_score ?? 0),
      cited_chunk_ids: Array.isArray(j.cited_chunk_ids) ? j.cited_chunk_ids.map(String) : [],
      insufficient_evidence: Boolean(j.insufficient_evidence ?? false),
      escalation_recommended: Boolean(j.escalation_recommended ?? false),
      escalation_reason: j.escalation_reason ? String(j.escalation_reason) : null,
      reasoning: j.reasoning ? String(j.reasoning) : undefined,
    };
  } catch {
    return {
      answer: raw.trim(),
      confidence_score: 0,
      cited_chunk_ids: [],
      insufficient_evidence: true,
      escalation_recommended: false,
      escalation_reason: null,
    };
  }
}
