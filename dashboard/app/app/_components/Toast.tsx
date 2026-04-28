'use client';

// Tiny toast system. One provider at the root, one `useToast()` hook that
// returns a push() fn. No dependencies. Auto-dismiss after 3s. Newest at
// the top of the stack. Accessible: role="status", aria-live="polite".
//
// Usage:
//   const toast = useToast();
//   toast.push({ kind: 'success', message: 'Saved' });

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';
export type ToastInput = { message: string; kind?: Kind; durationMs?: number };
type Toast = { id: number; message: string; kind: Kind; durationMs: number };

type Ctx = { push: (t: ToastInput) => void };
const ToastCtx = createContext<Ctx | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: ToastInput) => {
    const toast: Toast = {
      id: nextId++,
      message: t.message,
      kind: t.kind ?? 'info',
      durationMs: t.durationMs ?? 3000,
    };
    setToasts((prev) => [toast, ...prev].slice(0, 4));
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  // Graceful fallback if someone uses the hook outside the provider —
  // silently no-op so we don't crash the app during testing.
  return ctx ?? { push: () => {} };
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.durationMs, onDismiss]);

  const tone =
    toast.kind === 'success'
      ? 'border-purity-green/40 bg-white text-purity-bean dark:bg-purity-shade dark:text-purity-paper'
      : toast.kind === 'error'
        ? 'border-purity-rust/40 bg-white text-purity-bean dark:bg-purity-shade dark:text-purity-paper'
        : 'border-purity-bean/20 bg-white text-purity-bean dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper';

  const accent =
    toast.kind === 'success' ? 'text-purity-green' :
    toast.kind === 'error'   ? 'text-purity-rust' :
                               'text-purity-muted dark:text-purity-mist';

  const glyph = toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '!' : 'i';

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border p-3 text-sm shadow-lg ${tone}`}
    >
      <span aria-hidden="true" className={`mt-0.5 font-bold ${accent}`}>{glyph}</span>
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 text-purity-muted transition hover:text-purity-bean dark:text-purity-mist dark:hover:text-purity-paper"
      >
        ✕
      </button>
    </div>
  );
}
