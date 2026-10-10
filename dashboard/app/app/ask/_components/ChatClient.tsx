'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RatingButtons } from './RatingButtons';
import { CopyButton } from '../../_components/CopyButton';
import { useToast } from '../../_components/Toast';
import { AnswerText } from './AnswerText';
import { safeHref } from '@/lib/safe-url';
import type { LabPanel } from '@/lib/rag/lab-lookup';
import { displaySourceTitle, evidenceTypeLabel } from '@/lib/rag/source-label';

type Turn = {
  role: 'user' | 'assistant';
  content: string;
  meta?: {
    source?: 'canon' | 'llm';
    confidence?: number;
    escalated?: boolean;
    freshness_tier?: string;
    cited_chunks?: { id: string; title: string; kind: string; chapter: string | null }[];
    lab_links?: { label: string; url: string }[];
    lab_panel?: LabPanel | null;
    route?: string;
    message_id?: string;
  };
};

const SUGGESTED = [
  'Is PROTECT good for someone with acid reflux?',
  'How does Purity test for mycotoxins?',
  'What\'s the CGA level in FLOW?',
  'Is Swiss Water decaf actually chemical-free?',
  'Does Purity ship to Canada?',
];

function newSessionId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export default function ChatClient({ paperCount, initialQuestion, deepMode }: { paperCount?: number | null; initialQuestion?: string; deepMode?: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  // Prefilled when arriving from the Home ask box (/ask?q=...).
  const [input, setInput] = useState(initialQuestion ?? '');
  const [busy, setBusy] = useState(false);
  const sessionId = useRef(newSessionId());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // Auto-scroll the message column to the latest turn after a send/receive.
  useEffect(() => {
    if (turns.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, busy]);

  // Global "/" to focus the input — power-user shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput(''); setBusy(true);
    const next: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);

    const prior = next.slice(-6).map((t) => ({ role: t.role, content: t.content }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, session_id: sessionId.current, prior }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const secs = j.retry_after_seconds ?? 60;
        setTurns([
          ...next,
          {
            role: 'assistant',
            content:
              j.reason === 'rpd_exceeded'
                ? `Daily message limit reached. Try again tomorrow, or ask an editor to raise your cap.`
                : `You're sending messages faster than the rate limit. Try again in ${secs}s.`,
          },
        ]);
      } else if (!res.ok) {
        setTurns([...next, { role: 'assistant', content: `Error: ${j.error ?? 'unknown'}` }]);
      } else {
        setTurns([
          ...next,
          {
            role: 'assistant',
            content: j.answer,
            meta: {
              source: j.source,
              confidence: j.confidence_score,
              escalated: j.escalated,
              freshness_tier: j.freshness_tier,
              cited_chunks: j.cited_chunks,
              lab_links: j.lab_links,
              lab_panel: j.lab_panel,
              route: j.route,
              message_id: j.message_id,
            },
          },
        ]);
      }
    } catch (e) {
      setTurns([...next, { role: 'assistant', content: `Network error: ${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  // In-page confirmation, not window.confirm(): a native dialog blocks the tab
  // (and froze automated testing).
  const [confirmReset, setConfirmReset] = useState(false);

  function resetSession() {
    if (turns.length === 0) {
      sessionId.current = newSessionId();
      return;
    }
    setConfirmReset(true);
  }

  function doReset() {
    sessionId.current = newSessionId();
    setTurns([]);
    setConfirmReset(false);
    toast.push({ kind: 'info', message: 'New session started.' });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,320px]">
      <section className="flex flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-serif text-2xl">Ask</h1>
          {confirmReset ? (
            <div role="group" aria-label="Confirm reset" className="flex flex-wrap items-center gap-2 text-xs text-purity-muted dark:text-purity-mist">
              <span>Clear this conversation and its context?</span>
              <button
                type="button"
                onClick={doReset}
                autoFocus
                className="rounded-md bg-purity-bean px-3 py-1.5 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded-md border border-purity-bean/20 px-3 py-1.5 text-xs dark:border-purity-paper/20"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={resetSession}
              className="rounded-md border border-purity-bean/20 px-3 py-1.5 text-xs text-purity-muted transition hover:bg-purity-bean/5 dark:border-purity-paper/20 dark:text-purity-mist dark:hover:bg-purity-paper/5"
            >
              Reset conversation
            </button>
          )}
        </div>

        <div
          className="space-y-4 rounded-lg border border-purity-bean/10 bg-white p-4 shadow-sm dark:border-purity-paper/10 dark:bg-purity-shade dark:shadow-none sm:p-5"
          aria-live="polite"
        >
          {turns.length === 0 && !busy && (
            <p className="text-sm text-purity-muted dark:text-purity-mist">
              Ask a customer-service or research question. Lab questions are answered from
              Brian&apos;s Lab Testing tracker, the same results as the COA quick view. Everything
              else comes from the Purity knowledge base (brand docs, Ildi&apos;s book,{' '}
              {typeof paperCount === 'number'
                ? `${paperCount.toLocaleString()} research papers`
                : 'the research library'}
              , curated Q&amp;A). It will escalate to Ildi or Jeremy when the evidence isn&apos;t
              sufficient.
            </p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'text-right' : 'group'}>
              <div
                className={
                  t.role === 'user'
                    ? 'inline-block max-w-full rounded-lg bg-purity-green/10 px-3 py-2 text-sm dark:bg-purity-aqua/20'
                    : 'prose prose-sm max-w-none text-purity-bean dark:text-purity-paper'
                }
              >
                {t.role === 'assistant' ? <AnswerText text={t.content} /> : t.content}
              </div>
              {t.meta?.lab_panel && t.meta.lab_panel.rows.length > 0 && (
                <div className="mt-2 rounded-lg bg-purity-soft p-3 dark:bg-purity-night">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-purity-muted dark:text-purity-mist">
                    <span className="min-w-0">{t.meta.lab_panel.title ?? `${t.meta.lab_panel.product}: latest results`}</span>
                    <a href={safeHref(t.meta.lab_panel.href) ?? '/coa'} className="shrink-0 normal-case tracking-normal underline">COA quick view</a>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {t.meta.lab_panel.rows.map((r) => (
                      <div key={r.key ?? r.code} className="flex min-w-0 items-center justify-between gap-2 text-sm" title={r.date ? `Tested ${r.date}` : undefined}>
                        <span className="min-w-0 truncate">
                          {r.who ? <span className="font-medium">{r.who} · </span> : null}
                          {r.label}{r.value ? ` · ${r.value}` : ''}{r.who && r.date ? ` · ${r.date}` : ''}
                        </span>
                        <span className={`st st-${r.status} shrink-0`}>{r.text}</span>
                      </div>
                    ))}
                  </div>
                  {t.meta.lab_panel.note && (
                    <p className="mt-2 text-xs text-purity-muted dark:text-purity-mist">{t.meta.lab_panel.note}</p>
                  )}
                </div>
              )}
              {t.role === 'assistant' && t.content && (
                <div className="mt-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                  <CopyButton text={t.content} label="Copy answer" ariaLabel="Copy this answer" />
                </div>
              )}
              {t.meta && (
                <div className="mt-1 text-xs text-purity-muted dark:text-purity-mist">
                  {t.meta.route ? `answered as ${t.meta.route} · ` : null}
                  {t.meta.source === 'canon' ? 'curated answer · ' : null}
                  {typeof t.meta.confidence === 'number' ? `confidence ${t.meta.confidence.toFixed(2)} · ` : null}
                  {t.meta.freshness_tier ? `${t.meta.freshness_tier} · ` : null}
                  {t.meta.escalated ? <span className="text-purity-rust">escalated to Ildi / Jeremy</span> : null}
                  {t.meta.cited_chunks && t.meta.cited_chunks.length > 0 && (
                    <div className="mt-1">
                      sources: {t.meta.cited_chunks.map((c, k) => (
                        <span key={c.id}>
                          {k > 0 && ', '}
                          <span title={evidenceTypeLabel(c)}>{displaySourceTitle(c)}{c.chapter ? ` (ch ${c.chapter})` : ''}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {t.meta.lab_links && t.meta.lab_links.length > 0 && (
                    <div className="mt-1">
                      lab data:{' '}
                      {t.meta.lab_links.filter((l) => safeHref(l.url)).map((l, k) => (
                        <span key={l.url}>
                          {k > 0 && ' · '}
                          <a
                            href={safeHref(l.url) ?? undefined}
                            {...(l.url.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                            className="underline decoration-dotted underline-offset-2 hover:text-purity-bean dark:hover:text-purity-paper"
                          >
                            {l.label}
                          </a>
                        </span>
                      ))}
                    </div>
                  )}
                  {t.meta.message_id && t.role === 'assistant' && (
                    <RatingButtons messageId={t.meta.message_id} />
                  )}
                </div>
              )}
            </div>
          ))}
          {/* Typing indicator — visible while waiting for a response */}
          {busy && turns.length > 0 && (
            <div aria-label="Reva is thinking…" role="status">
              <div className="flex items-center gap-1 px-1 py-0.5">
                <span
                  className="h-2 w-2 animate-bounce rounded-full bg-purity-green/50 dark:bg-purity-aqua/50"
                  style={{ animationDelay: '0ms', animationDuration: '900ms' }}
                />
                <span
                  className="h-2 w-2 animate-bounce rounded-full bg-purity-green/50 dark:bg-purity-aqua/50"
                  style={{ animationDelay: '180ms', animationDuration: '900ms' }}
                />
                <span
                  className="h-2 w-2 animate-bounce rounded-full bg-purity-green/50 dark:bg-purity-aqua/50"
                  style={{ animationDelay: '360ms', animationDuration: '900ms' }}
                />
              </div>
            </div>
          )}
          <div ref={bottomRef} aria-hidden="true" />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="mt-4 flex gap-2"
          role="search"
          aria-label="Ask the Purity research assistant"
        >
          <label htmlFor="chat-input" className="sr-only">Your question</label>
          <input
            id="chat-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about blends, roasting, mycotoxins, studies, COAs…"
            className="flex-1 rounded-md border border-purity-bean/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-purity-green dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper dark:placeholder:text-purity-mist/70 dark:focus:border-purity-aqua"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-md bg-purity-bean px-4 py-2 text-sm font-medium text-purity-cream transition disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink dark:hover:bg-purity-aqua/90"
          >
            {busy ? <span aria-label="Sending…">…</span> : 'Ask'}
          </button>
        </form>
        <p className="mt-1 text-[11px] text-purity-muted/70 dark:text-purity-mist/70">
          Press <kbd className="rounded border border-purity-bean/20 px-1 dark:border-purity-paper/20">/</kbd> to focus · <kbd className="rounded border border-purity-bean/20 px-1 dark:border-purity-paper/20">Enter</kbd> to send
        </p>
      </section>

      <aside className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
        <h2 className="mb-2 font-serif text-base">Session</h2>
        <p className="text-xs text-purity-muted dark:text-purity-mist">
          Context window: last 3 turns within this session. Resetting clears context. Each message
          is logged for editor review and canon improvement.
        </p>
        {deepMode && (
          <>
            <h2 className="mb-2 mt-5 font-serif text-base">Deep mode</h2>
            <p className="text-xs text-purity-muted dark:text-purity-mist">
              For long-form analysis with the full research stack, use{' '}
              <Link href="/reva" className="font-semibold underline">Reva</Link> (admins only).
            </p>
          </>
        )}
        <h2 className="mb-2 mt-5 font-serif text-base">Suggested prompts</h2>
        <ul className="space-y-1.5 text-xs">
          {SUGGESTED.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => send(s)}
                className="w-full rounded border border-transparent p-1 text-left text-purity-muted transition hover:border-purity-bean/15 hover:bg-purity-cream hover:text-purity-bean dark:text-purity-mist dark:hover:border-purity-paper/20 dark:hover:bg-purity-ink dark:hover:text-purity-paper"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
