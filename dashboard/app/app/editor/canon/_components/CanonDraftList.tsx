'use client';

import { useState } from 'react';
import { CanonDraftCard } from './CanonDraftCard';
import { EmptyState } from '../../../_components/EmptyState';

type Draft = {
  id: string;
  question: string;
  answer: string;
  created_at: string;
  created_by: string | null;
  origin_message_id: string | null;
};

export function CanonDraftList({ drafts }: { drafts: Draft[] }) {
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const visible = drafts.filter((d) => !settled.has(d.id));

  function onSettle(id: string) {
    setSettled((prev) => new Set([...prev, id]));
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        tone="success"
        title="No drafts pending."
        body="All canon drafts have been reviewed. Promote more answers from the editor queue to build up the canon cache."
        action={{ label: 'Go to editor queue', href: '/editor' }}
      />
    );
  }

  return (
    <ul className="space-y-4">
      {visible.map((d) => (
        <CanonDraftCard key={d.id} draft={d} onSettle={onSettle} />
      ))}
    </ul>
  );
}
