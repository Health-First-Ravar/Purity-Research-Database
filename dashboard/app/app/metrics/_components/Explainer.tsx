'use client';

// Collapsible explainer. Defines the new labels in plain English.

import { useState } from 'react';

const ITEMS: { label: string; body: string }[] = [
  {
    label: 'Conversations',
    body: 'How many people sent at least one question through the chat in the selected window. One conversation can have multiple back-and-forth turns.',
  },
  {
    label: 'Answered confidently',
    body: 'The share of conversations Reva handled directly in chat without needing Ildi or Jeremy to step in. Higher is better. Below 50% means we are punting too often, usually a sign of a missing canon answer or an over-cautious prompt.',
  },
  {
    label: 'Customer satisfaction',
    body: 'When customers click the thumbs-up or thumbs-down on an answer, this is the share that were thumbs-up. Shows up once people start rating; before that you will see "no thumbs ratings yet."',
  },
  {
    label: 'AI cost this period',
    body: 'Total dollar cost of the language model calls (Sonnet for answers, Haiku for classification) over the window. Roughly $0.01–$0.05 per conversation depending on length.',
  },
  {
    label: 'Average response time',
    body: 'How long, on average, the chat takes to send back a complete answer. Target is under 4 seconds; 4–8 seconds is acceptable; above 8 seconds is slow enough that customers notice.',
  },
  {
    label: 'Quick answers ready',
    body: 'The share of questions answered from a saved canon answer (instant, free) instead of a fresh language-model call. Grows as Ildi promotes good answers from the editor queue.',
  },
  {
    label: 'Waiting on a person',
    body: 'Conversations the system flagged for human follow-up that no one has answered yet. This is the editor inbox.',
  },
  {
    label: 'Good answers to save',
    body: 'Conversations the customer thumbs-upped that are not yet in the canon library. Promoting them turns one good answer into a permanent quick answer.',
  },
  {
    label: 'Answers that need work',
    body: 'Conversations the customer thumbs-downed or that the system itself flagged as low-quality. The triage queue for fixing or rewriting.',
  },
];

export function Explainer() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-purity-bean/10 bg-purity-cream/40 dark:border-purity-paper/10 dark:bg-purity-ink/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left text-sm font-medium text-purity-bean dark:text-purity-paper"
      >
        <span>What these numbers mean</span>
        <span aria-hidden>{open ? '–' : '+'}</span>
      </button>
      {open && (
        <dl className="grid gap-4 px-4 pb-4 text-sm sm:grid-cols-2">
          {ITEMS.map((it) => (
            <div key={it.label}>
              <dt className="font-medium text-purity-bean dark:text-purity-paper">{it.label}</dt>
              <dd className="mt-0.5 text-purity-muted dark:text-purity-mist">{it.body}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
