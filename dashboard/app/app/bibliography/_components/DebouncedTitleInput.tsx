'use client';

// Debounced title search for the bibliography catalog.
//
// Typing updates the ?title= query param via router.replace 300ms after the
// last keystroke, so we don't fire a Supabase query on every character but
// results still feel live. Also preserves the rest of the search params.

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function DebouncedTitleInput({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const router = useRouter();
  const params = useSearchParams();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params?.toString() ?? '');
      if (value.trim()) next.set('title', value);
      else next.delete('title');
      // replace (not push) so the back button doesn't fill up with keystrokes
      router.replace(`/bibliography${next.toString() ? `?${next}` : ''}`);
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Only re-run on the typed value — params object changes every render
    // but we want to debounce on user input, not on route updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      name="title"
      placeholder="search title…"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper dark:placeholder:text-purity-mist/70 md:col-span-2"
      aria-label="Search bibliography titles"
    />
  );
}
