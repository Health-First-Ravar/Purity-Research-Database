'use client';

// Floating Reva helper. Desktop-only (hidden on small screens).
// Closed: 48px brand-mark button bottom-left. Open: 360x520 panel.
// ⌘/ or Ctrl/ toggles. ESC closes.

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

type Suggestion = { href: string; label: string; why: string };

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestion?: Suggestion | null;
};

// First-open greeting is itself a haiku (5-7-5). Reva runs on Haiku the model;
// also literally one when she wants. Type /haiku <question> to get a poetic reply.
const GREETING_TEXT =
  "I'm Reva, your guide.\nCoffee, the app, where to click.\nPowered by Haiku.";

const GREETING_HINT =
  "Type a question, or try /haiku <anything> for a poetic answer. ⌘/ toggles me.";

export function RevaClippy() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [greeted, setGreeted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  // Keyboard: ⌘/ or Ctrl/ toggles open. ESC closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Greet once on first open. Greeting is a haiku; second turn is the hint.
  useEffect(() => {
    if (open && !greeted) {
      setTurns([
        { id: 'greet',  role: 'assistant', content: GREETING_TEXT, suggestion: null },
        { id: 'greet2', role: 'assistant', content: GREETING_HINT, suggestion: null },
      ]);
      setGreeted(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (open) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60);
    }
  }, [open, greeted]);

  // Auto-scroll on new turns
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    const userTurn: Turn = { id: crypto.randomUUID(), role: 'user', content: q };
    const next = [...turns, userTurn];
    setTurns(next);

    const prior = next.slice(-6).map((t) => ({ role: t.role, content: t.content }));

    try {
      const res = await fetch('/api/reva-helper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, prior, current_path: pathname }),
      });
      const j = await res.json();
      if (!res.ok) {
        setTurns([...next, {
          id: crypto.randomUUID(), role: 'assistant',
          content: j.error === 'unauthorized'
            ? 'Sign in to chat with me.'
            : `Error: ${j.error ?? 'unknown'}`,
          suggestion: null,
        }]);
      } else {
        setTurns([...next, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: j.answer,
          suggestion: j.suggested_tab ?? null,
        }]);
      }
    } catch (e) {
      setTurns([...next, {
        id: crypto.randomUUID(), role: 'assistant',
        content: `Network error: ${String(e)}`, suggestion: null,
      }]);
    } finally {
      setBusy(false);
    }
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      {/* Desktop-only: hidden below lg breakpoint (1024px) */}
      <div className="hidden lg:block">
        {/* Closed state: floating brand-mark button */}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open Reva helper"
            title="Ask Reva (⌘/)"
            className="fixed bottom-4 left-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-purity-green text-purity-cream shadow-lg transition hover:scale-105 hover:bg-purity-bean dark:bg-purity-aqua dark:text-purity-ink dark:hover:bg-purity-green"
          >
            <span className="font-serif text-2xl italic">R</span>
          </button>
        )}

        {/* Open state: panel */}
        {open && (
          <div
            role="dialog"
            aria-label="Reva helper"
            className="fixed bottom-4 left-4 z-40 flex h-[520px] w-[360px] flex-col overflow-hidden rounded-xl border border-purity-bean/15 bg-white shadow-2xl dark:border-purity-paper/15 dark:bg-purity-shade"
          >
            {/* Header */}
            <header className="flex items-center gap-3 border-b border-purity-bean/10 bg-purity-cream px-3 py-2 dark:border-purity-paper/10 dark:bg-purity-ink">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-purity-green text-purity-cream font-serif text-lg italic dark:bg-purity-aqua dark:text-purity-ink">
                R
              </span>
              <div className="flex-1">
                <div className="text-sm font-medium text-purity-bean dark:text-purity-paper">Ask Reva</div>
                <div className="text-[10px] uppercase tracking-wide text-purity-muted dark:text-purity-mist">in-app helper</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded p-1 text-purity-muted hover:bg-purity-bean/5 hover:text-purity-bean dark:text-purity-mist dark:hover:bg-purity-paper/5 dark:hover:text-purity-paper"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>

            {/* Thread */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <ul className="space-y-3">
                {turns.map((t) => (
                  <li key={t.id} className={t.role === 'user' ? 'text-right' : ''}>
                    <div
                      className={
                        'inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm leading-snug ' +
                        (t.role === 'user'
                          ? 'bg-purity-aqua/15 text-purity-bean dark:bg-purity-aqua/20 dark:text-purity-paper'
                          : 'bg-purity-cream text-purity-bean dark:bg-purity-ink dark:text-purity-paper')
                      }
                    >
                      <div className="whitespace-pre-wrap">{t.content}</div>
                      {t.suggestion && (
                        <button
                          type="button"
                          onClick={() => go(t.suggestion!.href)}
                          className="mt-2 inline-flex items-center gap-1 rounded-md border border-purity-green/40 bg-purity-green/5 px-2 py-1 text-xs font-medium text-purity-green hover:bg-purity-green/15 dark:border-purity-aqua/40 dark:bg-purity-aqua/10 dark:text-purity-aqua dark:hover:bg-purity-aqua/20"
                          title={t.suggestion.why}
                        >
                          <span>→</span>
                          <span>{t.suggestion.label}</span>
                        </button>
                      )}
                    </div>
                  </li>
                ))}
                {busy && (
                  <li>
                    <div className="inline-block rounded-lg bg-purity-cream px-3 py-2 text-sm text-purity-muted dark:bg-purity-ink dark:text-purity-mist">
                      Thinking…
                    </div>
                  </li>
                )}
              </ul>
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <footer className="border-t border-purity-bean/10 p-2 dark:border-purity-paper/10">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
                  placeholder="Ask anything…"
                  className="flex-1 rounded-md border border-purity-bean/15 bg-white px-2 py-1.5 text-sm text-purity-bean placeholder:text-purity-muted focus:border-purity-green focus:outline-none dark:border-purity-paper/15 dark:bg-purity-ink dark:text-purity-paper dark:placeholder:text-purity-mist"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={busy || !input.trim()}
                  className="rounded-md bg-purity-green px-3 py-1.5 text-sm text-purity-cream disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
                >
                  Send
                </button>
              </div>
              <div className="mt-1 text-center text-[10px] text-purity-muted dark:text-purity-mist">
                ⌘/ to toggle · ESC to close · /haiku for poetry
              </div>
            </footer>
          </div>
        )}
      </div>
    </>
  );
}
