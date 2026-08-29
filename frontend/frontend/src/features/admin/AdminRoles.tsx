import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, PageHeader, StatusBadge, fmtDate } from './_shared';
import { useAuth } from '@/lib/auth';

interface Staff {
  id: string;
  username: string;
  full_name?: string | null;
  email?: string | null;
  role: string;
  is_active: boolean;
  last_login_at?: string | null;
  created_at?: string | null;
}

const ROLES = ['admin', 'examiner', 'teacher', 'partner', 'super_admin'];

export function AdminRoles() {
  const qc = useQueryClient();
  const { role: myRole } = useAuth();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', password: '', role: 'examiner', full_name: '', email: '' });

  const { data, isLoading } = useQuery({ queryKey: ['admin-staff'], queryFn: () => unwrap<Staff[]>(api.get('/admin/users/staff')) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-staff'] });

  const create = useMutation({
    mutationFn: () => {
      if (!form.username.trim() || form.password.length < 6) throw new Error('Username and a 6+ char password are required');
      return unwrap(api.post('/admin/users/staff', {
        username: form.username, password: form.password, role: form.role,
        full_name: form.full_name || null, email: form.email || null,
      }));
    },
    onSuccess: () => { setError(''); setForm({ username: '', password: '', role: 'examiner', full_name: '', email: '' }); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const block = useMutation({
    mutationFn: ({ username, active }: { username: string; active: boolean }) =>
      unwrap(api.post(`/admin/users/${username}/${active ? 'unblock' : 'block'}`, active ? undefined : { reason: 'Blocked by admin' })),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const resetPw = useMutation({
    mutationFn: (username: string) => {
      const pw = window.prompt(`New password for ${username} (min 6 chars)`);
      if (!pw || pw.length < 6) throw new Error('Password must be at least 6 characters');
      return unwrap(api.post('/admin/users/reset-password', { username, new_password: pw }));
    },
    onSuccess: () => setError(''),
    onError: (e: Error) => setError(e.message),
  });

  const roleOptions = ROLES.filter((r) => r !== 'super_admin' || myRole === 'super_admin');

  const columns: Column<Staff>[] = [
    { key: 'username', header: 'Username', sort: (u) => u.username, cell: (u) => <span className="font-mono text-xs">{u.username}</span> },
    { key: 'full_name', header: 'Name', sort: (u) => u.full_name ?? '', cell: (u) => u.full_name || '—' },
    { key: 'role', header: 'Role', sort: (u) => u.role, cell: (u) => <StatusBadge status={u.role} /> },
    { key: 'is_active', header: 'Status', sort: (u) => (u.is_active ? 1 : 0), cell: (u) => (u.is_active ? <span className="badge bg-green-100 text-green-700">Active</span> : <span className="badge bg-red-100 text-red-700">Blocked</span>) },
    { key: 'last_login_at', header: 'Last login', sort: (u) => u.last_login_at ?? '', cell: (u) => <span className="text-slate-500">{fmtDate(u.last_login_at)}</span> },
    {
      key: 'actions',
      header: 'Actions',
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          <button className="btn-ghost py-1 text-xs" onClick={() => resetPw.mutate(u.username)}>Reset PW</button>
          {u.role !== 'super_admin' && (
            <button
              className={`btn-ghost py-1 text-xs ${u.is_active ? 'text-red-600' : 'text-green-700'}`}
              onClick={() => block.mutate({ username: u.username, active: !u.is_active })}
            >
              {u.is_active ? 'Block' : 'Unblock'}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Roles & Permissions" description="Role-based access control — manage staff accounts and access." />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="card mt-4">
        <h2 className="text-sm font-semibold text-slate-700">Create staff account</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <input className="input" placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className="input" type="password" placeholder="Password (6+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input className="input" placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>Create</button>
        </div>
      </div>

      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(u) => u.id}
        searchText={(u) => `${u.username} ${u.full_name ?? ''} ${u.email ?? ''} ${u.role}`}
        searchPlaceholder="Search staff"
        emptyLabel="No staff accounts."
      />
    </div>
  );
}
