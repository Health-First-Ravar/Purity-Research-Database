'use client';

// Invisible helper: when dropped into a <form>, it auto-submits the form
// whenever any child select/checkbox/number input changes. Keeps URL query
// params (the source of truth for the bibliography filters) in sync without
// forcing the user to click Apply.
//
// - Triggers on `change` (not `input`) so selects and checkboxes fire once,
//   and number/date fields fire on blur-or-enter.
// - Skips the debounced title input — its own useEffect drives router.replace
//   and we don't want a double submit on every keystroke.
// - Uses requestSubmit() so HTML constraints still run (better than .submit()).

import { useEffect, useRef } from 'react';

export function FormAutoSubmit() {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;

    function onChange(e: Event) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Skip the debounced title field — it handles its own URL updates.
      if (t instanceof HTMLInputElement && t.name === 'title') return;
      form?.requestSubmit();
    }

    form.addEventListener('change', onChange);
    return () => form.removeEventListener('change', onChange);
  }, []);

  // Zero-size anchor; its only job is giving us a DOM handle via ref.
  return <span ref={anchor} aria-hidden="true" className="hidden" />;
}
