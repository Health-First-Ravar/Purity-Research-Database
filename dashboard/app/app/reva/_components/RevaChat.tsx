'use client';

// The Reva chat thread. Operator surface — darker chrome, "studio" feel.
// Slash commands: /audit <text>, /heatmap <topic>, /cite <doi>.

import { useEffect, useRef, useState } from 'react';
import { ModeSwitcher, type Mode } from './ModeSwitcher';

export type RevaMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  mode: Mode | null;
  content: string;
  cited_chunks: { id: string; title: string; kind: string; chapter: string | null; similarity?: number }[];
  flags: { left_evidence?: boolean; regulatory_risk?: boolean; weakest_link?: string | null } | null;
  created_at: string;
  latency_ms: number | null;
  cost_usd: number | null;
};

export function RevaChat({
  sessionId,
  title,
  defaultMode,
  initial,
}: {
  sessionId: string;
  title: string | null;
  defaultMode: Mode;
  initial: RevaMessage[];
}) {
  const [turns, setTurns] = useState<RevaMessage[]>(initial);
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);

    // Slash command short-circuits
    if (q.startsWith('/audit ')) {
      const draft = q.slice(7).trim();
      pushUser(q);
      try {
        const res = await fetch('/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft, context: 'other' }),
        });
        const j = await res.json();
        pushAssistantInline(`**Claim audit**\n\n*Draft:* ${draft}\n\n*Compounds:* ${(j.compounds_detected ?? []).join(', ') || 'none'}\n*Weakest link:* ${j.weakest_link ?? '—'}\n*Regulatory flags:* ${(j.regulatory_flags ?? []).join(', ') || 'none'}\n*Evidence tier:* ${j.evidence_tier ?? '—'}\n\n**Suggested rewrite:**\n${j.suggested_rewrite ?? '—'}`);
      } catch (e) {
        pushAssistantInline(`audit failed: ${String(e)}`);
      } finally { setBusy(false); }
      return;
    }
    if (q.startsWith('/cite ')) {
      const doi = q.slice(6).trim();
      pushUser(q);
      pushAssistantInline(`Citation lookup is not yet wired here. Paste the DOI \`${doi}\` into the Bibliography page for now.`);
      setBusy(false);
      return;
    }

    pushUser(q);

    const prior = [...turns, { role: 'user' as const, content: q }]
      .slice(-8)
      .map((t) => ({ role: t.role === 'assistant' || t.role === 'user' ? t.role : 'user', content: t.content }));

    try {
      const res = await fetch('/api/reva', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, mode, question: q, prior }),
      });
      const j = await res.json();
      if (!res.ok) {
        pushAssistantInline(`Error: ${j.message ?? j.error ?? 'unknown'}`);
      } else {
        setTurns((t) => [
          ...t,
          {
            id: j.message_id ?? crypto.randomUUID(),
            role: 'assistant',
            mode,
            content: j.answer,
            cited_chunks: j.cited_chunks ?? [],
            flags: j.flags ?? null,
            created_at: j.created_at ?? new Date().toISOString(),
            latency_ms: j.latency_ms ?? null,
            cost_usd: j.cost_usd ?? null,
          },
        ]);
      }
    } catch (e) {
      pushAssistantInline(`Network error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function pushUser(content: string) {
    setTurns((t) => [
      ...t,
      { id: crypto.randomUUID(), role: 'user', mode, content, cited_chunks: [], flags: null, created_at: new Date().toISOString(), latency_ms: null, cost_usd: null },
    ]);
  }
  function pushAssistantInline(content: string) {
    setTurns((t) => [
      ...t,
      { id: crypto.randomUUID(), role: 'assistant', mode, content, cited_chunks: [], flags: null, created_at: new Date().toISOString(), latency_ms: null, cost_usd: null },
    ]);
  }

  return (
    <section className="flex flex-col rounded-lg border border-purity-bean/10 bg-purity-bean/95 text-purity-cream dark:border-purity-paper/10 dark:bg-purity-ink">
      <header className="border-b border-purity-paper/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-serif text-base">{title || 'Untitled session'}</h2>
          <span className="text-[10px] uppercase tracking-wide opacity-60">Ask Reva · operator mode</span>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-4 py-4">
        {turns.length === 0 && (
          <p className="text-sm opacity-70">
            Ask anything. Switch mode at the bottom: Create drafts, Analyze evidence, or Challenge a claim.
            Slash commands: <code>/audit &lt;text&gt;</code>, <code>/cite &lt;doi&gt;</code>.
          </p>
        )}
        <ul className="space-y-4">
          {turns.map((t) => (
            <li key={t.id} className={t.role === 'user' ? 'text-right' : ''}>
              <div className={
                'inline-block max-w-[85%] rounded-lg px-4 py-2 text-sm ' +
                (t.role === 'user'
                  ? 'bg-purity-aqua text-purity-ink'
                  : 'bg-purity-cream/5 text-purity-cream')
              }>
                {t.role === 'assistant' && t.mode && (
                  <div className="mb-1 text-[10px] uppercase tracking-wide opacity-70">{t.mode}</div>
                )}
                <div className="whitespace-pre-wrap leading-relaxed">{t.content}</div>
                {t.role === 'assistant' && t.flags && (t.flags.left_evidence || t.flags.regulatory_risk) && (
                  <div className="mt-2 space-y-1 text-[11px]">
                    {t.flags.left_evidence && (
                      <div className="rounded bg-amber-400/15 px-2 py-1 text-amber-200">
                        ⚠ Left the evidence — synthesis only. Verify before publishing.
                      </div>
                    )}
                    {t.flags.regulatory_risk && (
                      <div className="rounded bg-purity-rust/20 px-2 py-1 text-purity-rust">
                        ⚠ Regulatory risk in this draft. Run /audit on the candidate sentence.
                      </div>
                    )}
                    {t.flags.weakest_link && (
                      <div className="opacity-70">weakest link: {t.flags.weakest_link}</div>
                    )}
                  </div>
                )}
                {t.role === 'assistant' && t.cited_chunks?.length > 0 && (
                  <details className="mt-2 text-[11px] opacity-80">
                    <summary className="cursor-pointer">cited evidence ({t.cited_chunks.length})</summary>
                    <ul className="mt-1 space-y-1">
                      {t.cited_chunks.map((c) => (
                        <li key={c.id}>
                          {c.title}{c.chapter ? ` · ch ${c.chapter}` : ''} <span className="opacity-60">({c.kind})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          ))}
          {busy && (
            <li>
              <div className="inline-block rounded-lg bg-purity-cream/5 px-4 py-2 text-sm opacity-70">
                Thinking...
              </div>
            </li>
          )}
        </ul>
        <div ref={bottomRef} />
      </div>

      <footer className="space-y-2 border-t border-purity-paper/10 p-3">
        <ModeSwitcher mode={mode} onChange={setMode} />
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask Reva. ⌘/Ctrl + Enter to send. Try /audit or /cite."
            rows={2}
            className="flex-1 rounded border border-purity-paper/20 bg-purity-ink/40 px-3 py-2 text-sm text-purity-cream placeholder:text-purity-cream/40"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="rounded-md bg-purity-aqua px-4 py-2 text-sm font-medium text-purity-ink disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </footer>
    </section>
  );
}
