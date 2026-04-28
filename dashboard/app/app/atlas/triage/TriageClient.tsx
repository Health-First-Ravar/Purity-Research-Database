'use client';

import { useEffect, useState } from 'react';

type Branch = { id: string; label: string; color: string | null };

type Unmapped = {
  topic: string;
  count: number;
  sampleTitles: string[];
};

type Candidate = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  similarity: number | null;
  rationale_draft: string | null;
  status: 'pending' | 'approved' | 'dismissed';
};

export function TriageClient({ branches }: { branches: Branch[] }) {
  const [tab, setTab] = useState<'unmapped' | 'candidates'>('unmapped');
  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-purity-bean/10 dark:border-purity-paper/10">
        <TabBtn active={tab === 'unmapped'} onClick={() => setTab('unmapped')}>Unmapped topics</TabBtn>
        <TabBtn active={tab === 'candidates'} onClick={() => setTab('candidates')}>Cross-link candidates</TabBtn>
      </div>
      {tab === 'unmapped' ? <UnmappedTab branches={branches} /> : <CandidatesTab branches={branches} />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'border-b-2 px-3 py-2 text-sm transition ' +
        (active
          ? 'border-purity-green font-medium text-purity-green dark:border-purity-aqua dark:text-purity-aqua'
          : 'border-transparent text-purity-muted hover:text-purity-bean dark:text-purity-mist dark:hover:text-purity-paper')
      }
    >
      {children}
    </button>
  );
}

// ---- Unmapped tab ---------------------------------------------------------

function UnmappedTab({ branches }: { branches: Branch[] }) {
  const [items, setItems] = useState<Unmapped[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<Record<string, string>>({});
  const [savedTopics, setSavedTopics] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/atlas/unmapped')
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { items: Unmapped[] }) => { setItems(d.items); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, []);

  async function save(topic: string) {
    const branch_id = selectedBranch[topic];
    if (!branch_id) return;
    setSaving(topic);
    const res = await fetch('/api/atlas/unmapped', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, branch_id }),
    });
    setSaving(null);
    if (res.ok) setSavedTopics((s) => new Set(s).add(topic));
  }

  if (loading) return <div className="text-sm text-purity-muted dark:text-purity-mist">Loading unmapped topics…</div>;
  if (error) return <div className="rounded-lg border border-purity-rust/20 bg-purity-rust/5 p-4 text-sm text-purity-rust">Error: {error}</div>;

  return (
    <div>
      <p className="mb-4 text-sm text-purity-muted dark:text-purity-mist">
        These topic strings appeared on at least one source but didn&apos;t match any chapter or hardcoded keyword.
        Pick a branch and the atlas will remember — every future paper with this exact topic_category will route there automatically.
      </p>

      {items.length === 0 ? (
        <div className="rounded-lg border border-purity-bean/10 bg-white p-6 text-center text-sm text-purity-muted dark:border-purity-paper/10 dark:bg-purity-shade dark:text-purity-mist">
          No unmapped topics. Atlas is fully routed.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-purity-bean/10 bg-purity-cream/40 text-left text-xs text-purity-muted dark:border-purity-paper/10 dark:bg-purity-ink/30 dark:text-purity-mist">
                <th className="p-3">Topic category</th>
                <th className="p-3">Papers</th>
                <th className="p-3">Sample titles</th>
                <th className="p-3">Route to</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const isSaved = savedTopics.has(it.topic);
                return (
                  <tr key={it.topic} className={'border-b border-purity-bean/5 dark:border-purity-paper/5 ' + (isSaved ? 'opacity-50' : '')}>
                    <td className="p-3 font-mono text-xs">{it.topic}</td>
                    <td className="p-3 text-purity-muted dark:text-purity-mist">{it.count}</td>
                    <td className="p-3 text-xs text-purity-muted dark:text-purity-mist">
                      <ul className="space-y-1">
                        {it.sampleTitles.map((t, i) => (
                          <li key={i} className="truncate" style={{ maxWidth: 320 }}>· {t}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="p-3">
                      <select
                        value={selectedBranch[it.topic] ?? ''}
                        onChange={(e) => setSelectedBranch((s) => ({ ...s, [it.topic]: e.target.value }))}
                        disabled={isSaved}
                        className="rounded border border-purity-bean/20 bg-white px-2 py-1 text-xs dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
                      >
                        <option value="">(pick a branch)</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => save(it.topic)}
                        disabled={!selectedBranch[it.topic] || saving === it.topic || isSaved}
                        className="rounded bg-purity-bean px-3 py-1 text-xs font-medium text-purity-cream disabled:opacity-40 dark:bg-purity-aqua dark:text-purity-ink"
                      >
                        {isSaved ? '✓ saved' : saving === it.topic ? 'saving…' : 'route'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Candidates tab -------------------------------------------------------

function CandidatesTab({ branches }: { branches: Branch[] }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  function reload() {
    setLoading(true);
    fetch('/api/atlas/candidates?status=pending')
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { candidates: Candidate[] }) => { setCandidates(d.candidates); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }
  useEffect(() => { reload(); }, []);

  async function act(id: string, action: 'approve' | 'dismiss') {
    setActing(id);
    await fetch(`/api/atlas/candidates/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setActing(null);
    setCandidates((cs) => cs.filter((c) => c.id !== id));
  }

  async function runDiscovery() {
    setRunning(true);
    await fetch('/api/atlas/candidates/discover', { method: 'POST' });
    setRunning(false);
    reload();
  }

  function branchLabel(id: string) {
    return branches.find((b) => b.id === id)?.label ?? id;
  }

  if (loading) return <div className="text-sm text-purity-muted dark:text-purity-mist">Loading candidates…</div>;
  if (error) return <div className="rounded-lg border border-purity-rust/20 bg-purity-rust/5 p-4 text-sm text-purity-rust">Error: {error}</div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-purity-muted dark:text-purity-mist">
          Auto-discovered cross-branch candidates. Each is the highest-similarity chunk pair across the two branches with an LLM-drafted rationale.
        </p>
        <button
          onClick={runDiscovery}
          disabled={running}
          className="rounded bg-purity-bean px-3 py-1.5 text-xs font-medium text-purity-cream disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
        >
          {running ? 'discovering… (may take a minute)' : 'run discovery now'}
        </button>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-lg border border-purity-bean/10 bg-white p-6 text-center text-sm text-purity-muted dark:border-purity-paper/10 dark:bg-purity-shade dark:text-purity-mist">
          No pending candidates. Run discovery to surface new ones.
        </div>
      ) : (
        <ul className="space-y-3">
          {candidates.map((c) => (
            <li key={c.id} className="rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-medium">
                  {branchLabel(c.source_node_id)}
                  <span className="mx-2 text-purity-muted dark:text-purity-mist">↔</span>
                  {branchLabel(c.target_node_id)}
                </div>
                <span className="text-xs text-purity-muted dark:text-purity-mist">
                  similarity {c.similarity != null ? Number(c.similarity).toFixed(3) : '—'}
                </span>
              </div>
              <p className="mb-3 text-sm text-purity-muted dark:text-purity-mist">{c.rationale_draft ?? '(no draft)'}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => act(c.id, 'approve')}
                  disabled={acting === c.id}
                  className="rounded bg-purity-green px-3 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-purity-aqua dark:text-purity-ink"
                >
                  approve
                </button>
                <button
                  onClick={() => act(c.id, 'dismiss')}
                  disabled={acting === c.id}
                  className="rounded border border-purity-bean/20 px-3 py-1 text-xs text-purity-muted hover:bg-purity-cream/40 disabled:opacity-40 dark:border-purity-paper/20 dark:text-purity-mist dark:hover:bg-purity-ink/40"
                >
                  dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
