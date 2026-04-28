'use client';

import { useEffect, useState } from 'react';
import { useToast } from '../../../_components/Toast';

type Role = 'customer_service' | 'editor' | 'admin';

type User = {
  id: string;
  email: string | null;
  role: Role | 'user' | 'researcher';
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  customer_service: 'Research Hub, Reports, Bibliography, Audit only.',
  editor:           'Reports, Bibliography, Audit, Atlas, Heatmap, Canon, Editor queue. No chat, no Ask Reva, no Users, no Metrics.',
  admin:            'Full access. The only role that can manage users, see metrics, and use Ask Reva.',
};

const ROLE_LABEL: Record<Role | 'user' | 'researcher', string> = {
  customer_service: 'customer service',
  editor:           'editor',
  admin:            'admin',
  user:             'customer service',  // legacy display
  researcher:       'editor',             // legacy display
};

function normalizeRole(r: User['role']): Role {
  if (r === 'admin' || r === 'editor' || r === 'customer_service') return r;
  if (r === 'researcher') return 'editor';
  return 'customer_service';
}

export function UsersClient({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('customer_service');
  // per-row editing state
  const [editingName, setEditingName] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const toast = useToast();

  async function refresh() {
    const res = await fetch('/api/editor/users', { cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      setUsers(body.users ?? []);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/editor/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role, full_name: name.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Invite failed');
      toast.push({ kind: 'success', message: `Invite sent to ${email}.` });
      setEmail('');
      setName('');
      setRole('customer_service');
      // (default reset stays at customer_service for new invites)
      await refresh();
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(id: string, newRole: Role) {
    setBusy(true);
    try {
      const res = await fetch(`/api/editor/users?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Update failed');
      toast.push({ kind: 'success', message: `Role updated to ${ROLE_LABEL[newRole]}.` });
      await refresh();
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function saveName(id: string) {
    const full_name = editingName[id] ?? '';
    setBusy(true);
    try {
      const res = await fetch(`/api/editor/users?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Update failed');
      toast.push({ kind: 'success', message: 'Name updated.' });
      setEditingName((prev) => { const next = { ...prev }; delete next[id]; return next; });
      await refresh();
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/editor/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Delete failed');
      toast.push({ kind: 'success', message: 'User deleted.' });
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_340px]">
      {/* Users list */}
      <div className="rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
        <div className="border-b border-purity-bean/10 px-4 py-3 text-[10px] uppercase tracking-wider text-purity-muted dark:border-purity-paper/10 dark:text-purity-mist">
          {users == null ? 'loading…' : `${users.length} ${users.length === 1 ? 'user' : 'users'}`}
        </div>
        <ul>
          {users?.map((u) => {
            const isSelf = u.id === currentUserId;
            const isEditingThisName = u.id in editingName;
            const isConfirmingDelete = confirmDelete === u.id;
            return (
              <li key={u.id} className="border-b border-purity-bean/5 px-4 py-3 text-sm last:border-b-0 dark:border-purity-paper/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Identity block */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-medium">{u.email ?? '(no email)'}</div>
                      {isSelf && (
                        <span className="rounded-full bg-purity-cream/60 px-1.5 py-0 text-[10px] uppercase tracking-wider text-purity-muted dark:bg-purity-ink/40 dark:text-purity-mist">
                          you
                        </span>
                      )}
                    </div>

                    {/* Name — inline editable */}
                    {isEditingThisName ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); saveName(u.id); }}
                        className="mt-1 flex items-center gap-1.5"
                      >
                        <input
                          autoFocus
                          value={editingName[u.id]}
                          onChange={(e) => setEditingName((prev) => ({ ...prev, [u.id]: e.target.value }))}
                          disabled={busy}
                          placeholder="Full name"
                          className="rounded border border-purity-bean/20 bg-transparent px-2 py-0.5 text-xs outline-none focus:border-purity-green disabled:opacity-50 dark:border-purity-paper/20 dark:text-purity-paper"
                        />
                        <button type="submit" disabled={busy} className="text-[11px] text-purity-green hover:underline disabled:opacity-50 dark:text-purity-aqua">save</button>
                        <button type="button" onClick={() => setEditingName((prev) => { const n = { ...prev }; delete n[u.id]; return n; })} className="text-[11px] text-purity-muted hover:underline dark:text-purity-mist">cancel</button>
                      </form>
                    ) : (
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-purity-muted dark:text-purity-mist">
                        <span>
                          {u.full_name ?? <em>no name</em>}
                          {' · '}joined {new Date(u.created_at).toLocaleDateString()}
                          {u.last_sign_in_at
                            ? ` · last sign-in ${new Date(u.last_sign_in_at).toLocaleDateString()}`
                            : ' · never signed in'}
                        </span>
                        <button
                          onClick={() => setEditingName((prev) => ({ ...prev, [u.id]: u.full_name ?? '' }))}
                          className="shrink-0 text-[10px] text-purity-muted/50 hover:text-purity-green dark:text-purity-mist/50 dark:hover:text-purity-aqua"
                          title="Edit name"
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Role + delete */}
                  <div className="flex items-center gap-2">
                    <select
                      value={normalizeRole(u.role)}
                      onChange={(e) => changeRole(u.id, e.target.value as Role)}
                      disabled={busy || isSelf}
                      className="rounded border border-purity-bean/20 bg-transparent px-2 py-1 text-xs disabled:opacity-50 dark:border-purity-paper/20 dark:text-purity-paper"
                    >
                      <option value="customer_service">customer service</option>
                      <option value="editor">editor</option>
                      <option value="admin">admin</option>
                    </select>

                    {!isSelf && (
                      isConfirmingDelete ? (
                        <span className="flex items-center gap-1 text-[11px]">
                          <span className="text-purity-rust">Delete?</span>
                          <button
                            onClick={() => deleteUser(u.id)}
                            disabled={busy}
                            className="font-medium text-purity-rust hover:underline disabled:opacity-50"
                          >yes</button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-purity-muted hover:underline dark:text-purity-mist"
                          >no</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(u.id)}
                          disabled={busy}
                          title="Delete user"
                          className="text-purity-muted/40 hover:text-purity-rust disabled:opacity-30 dark:text-purity-mist/40 dark:hover:text-purity-rust"
                        >
                          ✕
                        </button>
                      )
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {users?.length === 0 && (
            <li className="p-4 text-sm text-purity-muted dark:text-purity-mist">No users yet.</li>
          )}
        </ul>
      </div>

      {/* Invite form */}
      <aside className="rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
        <h2 className="font-serif text-base">Invite a user</h2>
        <p className="mt-1 text-[11px] text-purity-muted dark:text-purity-mist">
          They&apos;ll get an email with a link to set their password and sign in.
        </p>
        <form onSubmit={invite} className="mt-3 space-y-3 text-sm">
          <label className="block">
            <span className="block text-xs font-medium text-purity-muted dark:text-purity-mist">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="someone@example.com"
              disabled={busy}
              className="mt-1 w-full rounded border border-purity-bean/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-purity-green disabled:opacity-50 dark:border-purity-paper/20 dark:text-purity-paper"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-purity-muted dark:text-purity-mist">Name (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className="mt-1 w-full rounded border border-purity-bean/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-purity-green disabled:opacity-50 dark:border-purity-paper/20 dark:text-purity-paper"
            />
          </label>
          <fieldset className="block">
            <legend className="text-xs font-medium text-purity-muted dark:text-purity-mist">Role</legend>
            <div className="mt-1 flex flex-col gap-1">
              <RoleButton role="customer_service" current={role} onClick={() => setRole('customer_service')} disabled={busy}>
                customer service
              </RoleButton>
              <RoleButton role="editor" current={role} onClick={() => setRole('editor')} disabled={busy}>
                editor
              </RoleButton>
              <RoleButton role="admin" current={role} onClick={() => setRole('admin')} disabled={busy}>
                admin
              </RoleButton>
            </div>
            <p className="mt-2 rounded bg-purity-cream/50 px-2 py-1.5 text-[11px] text-purity-muted dark:bg-purity-ink/40 dark:text-purity-mist">
              {ROLE_DESCRIPTIONS[role]}
            </p>
          </fieldset>
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="mt-1 w-full rounded bg-purity-bean px-3 py-1.5 text-xs font-medium text-purity-cream hover:bg-purity-bean/85 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink dark:hover:bg-purity-aqua/85"
          >
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </form>
      </aside>
    </div>
  );
}

function RoleButton({
  role, current, onClick, disabled, children,
}: {
  role: Role; current: Role; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  const active = role === current;
  const accents: Record<Role, string> = {
    customer_service: 'bg-purity-bean text-purity-cream dark:bg-purity-aqua dark:text-purity-ink',
    editor:           'bg-purity-gold text-purity-bean dark:bg-purity-gold dark:text-purity-ink',
    admin:            'bg-purity-green text-purity-cream dark:bg-purity-aqua dark:text-purity-ink',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'rounded px-3 py-1.5 text-left text-xs transition disabled:opacity-50 ' +
        (active
          ? accents[role]
          : 'border border-purity-bean/20 hover:bg-purity-cream dark:border-purity-paper/20 dark:text-purity-paper dark:hover:bg-purity-ink/40')
      }
    >
      {children}
    </button>
  );
}
