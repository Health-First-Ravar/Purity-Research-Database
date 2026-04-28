'use client';

// Three-state theme cycler: light → dark → system. Persisted in localStorage
// under "purity-theme". A companion inline script in <head> (ThemeScript)
// reads the same key before first paint to avoid a light-flash on reload.

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

function read(): Theme {
  if (typeof window === 'undefined') return 'system';
  const v = window.localStorage.getItem('purity-theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}

function apply(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  root.classList.toggle('dark', effective === 'dark');
  root.classList.toggle('light', effective === 'light');
  root.dataset.theme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const initial = read();
    setTheme(initial);
    apply(initial);
    setMounted(true);

    // If user picked 'system', stay in sync with OS changes.
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (read() === 'system') apply('system');
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  function cycle() {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
    window.localStorage.setItem('purity-theme', next);
    apply(next);
  }

  // Render a stable placeholder during SSR to keep hydration clean.
  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle color theme"
        className="rounded-md border border-purity-bean/20 px-2 py-1 text-xs text-purity-muted dark:border-purity-paper/20 dark:text-purity-mist"
      >
        ◐
      </button>
    );
  }

  const icon = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐';
  const label =
    theme === 'light' ? 'Light theme (click for dark)' :
    theme === 'dark'  ? 'Dark theme (click for system)' :
                        'System theme (click for light)';

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="rounded-md border border-purity-bean/20 bg-transparent px-2 py-1 text-xs text-purity-bean transition hover:border-purity-green hover:text-purity-green dark:border-purity-paper/20 dark:text-purity-paper dark:hover:border-purity-aqua dark:hover:text-purity-aqua"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
