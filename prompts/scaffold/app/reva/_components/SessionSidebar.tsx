'use client';

// Session list with pin/rename/new. New session creates via POST /api/reva/sessions
// then navigates to /reva/[id].

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export type SessionRow = {
  id: string;
  title: string | null;
  default_mode: 'create' | 'analyze' | 'challenge';
  pinned: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

const MODE_DOT: Record<SessionRow['default_mode'], string> = {
  create:    'bg-amber-400',
  analyze:   'bg-purity-aqua',
  challenge: 'bg-purity-rust',
};

export function SessionSidebar({ sessions, active }: { sessions: SessionRow[]; active: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [defaultMode, setDefaultMode] = useState<SessionRow['default_mode']>('analyze');

  function newSession() {
    startTransition(async () => {
      const res = await fetch('/api/reva/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_mode: defaultMode }),
      });
      const j = await res.json();
      if (j?.session?.id) router.push(`/reva/${j.session.id}`);
    });
  }

  return (
    <aside className="flex flex-col rounded-lg border border-purity-bean/10 bg-white p-3 dark:border-purity-paper/10 dark:bg-purity-shade">
      <div className="mb-3 space-y-2">
        <select
          value={defaultMode}
          onChange={(e) => setDefaultMode(e.target.value as SessionRow['default_mode'])}
          className="w-full rounded border border-purity-bean/20 bg-white px-2 py-1 text-xs dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
        >
          <option value="analyze">Analyze (default)</option>
          <option value="create">Create</option>
          <option value="challenge">Challenge</option>
        </select>
        <button
          onClick={newSession}
          disabled={pending}
          className="w-full rounded-md bg-purity-bean py-1.5 text-xs text-purity-cream disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
        >
          {pending ? 'Creating...' : '+ New session'}
        </button>
      </div>

      <div className="mb-2 text-[10px] uppercase tracking-wide text-purity-muted dark:text-purity-mist">Sessions</div>
      <ul className="flex-1 space-y-1 overflow-auto">
        {sessions.length === 0 && (
          <li className="text-xs text-purity-muted dark:text-purity-mist">No sessions yet.</li>
        )}
        {sessions.map((s) => (
          <li key={s.id}>
            <Link
              href={`/reva/${s.id}`}
              className={
                'flex items-center gap-2 rounded px-2 py-1.5 text-xs ' +
                (active === s.id
                  ? 'bg-purity-aqua/15 text-purity-bean dark:bg-purity-aqua/20 dark:text-purity-paper'
                  : 'text-purity-bean/80 hover:bg-purity-cream dark:text-purity-paper/80 dark:hover:bg-purity-ink')
              }
            >
              <span className={`inline-block h-2 w-2 rounded-full ${MODE_DOT[s.default_mode]}`} />
              <span className="truncate">{s.title || 'Untitled session'}</span>
              {s.pinned && <span aria-label="pinned">📌</span>}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
