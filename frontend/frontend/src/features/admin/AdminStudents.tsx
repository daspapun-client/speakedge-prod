import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Eye, Pencil, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, unwrap } from '@/lib/api';
import { AdminStudentLink, ApprovePlanModal, Column, DataTable, EmailLink, fmtDay, PageHeader, PhoneLink, RowAction, RowActionDivider, RowActions, StatusBadge, StudentAvatar, TableFilter, approveMembership } from './_shared';

interface SubSummary {
  active: { plan: string; started_at: string; expires_at: string } | null;
  total: number;
  past: number;
}

interface Student {
  student_id: string;
  full_name: string;
  email?: string;
  photo_url?: string | null;
  gender?: string | null;
  membership_status: string;
  cefr_status: string;
  created_at: string;
  subscription?: SubSummary;
  login_is_active?: boolean | null;
}

interface StudentDetail {
  student_id: string;
  full_name: string;
  age?: number | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  dob?: string | null;
  gender?: string | null;
  address?: string | null;
  state?: string | null;
  district?: string | null;
  pin_code?: string | null;
  about_me?: string | null;
  photo_url?: string | null;
  id_proof_url?: string | null;
  referral_code?: string | null;
  membership_status: string;
  cefr_status: string;
  cefr_level?: string | null;
  reject_reason?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  created_at: string;
  is_archived?: boolean;
}

interface StudentEditForm {
  full_name: string;
  age: string;
  email: string;
  phone: string;
  whatsapp: string;
  dob: string;
  gender: string;
  address: string;
  state: string;
  district: string;
  pin_code: string;
  about_me: string;
  membership_status: string;
  cefr_status: string;
  cefr_level: string;
  reject_reason: string;
}

const MEMBERSHIP_STATUSES = [
  'Pending Verification',
  'Active',
  'Rejected',
  'Suspended',
];

const CEFR_STATUSES = [
  'Self-Declared – Not Verified',
  'Verified',
];

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Not Sure', ''];

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function studentToForm(s: StudentDetail): StudentEditForm {
  return {
    full_name: s.full_name,
    age: s.age != null ? String(s.age) : '',
    email: s.email ?? '',
    phone: s.phone ?? '',
    whatsapp: s.whatsapp ?? '',
    dob: s.dob ?? '',
    gender: s.gender ?? '',
    address: s.address ?? '',
    state: s.state ?? '',
    district: s.district ?? '',
    pin_code: s.pin_code ?? '',
    about_me: s.about_me ?? '',
    membership_status: s.membership_status,
    cefr_status: s.cefr_status,
    cefr_level: s.cefr_level ?? '',
    reject_reason: s.reject_reason ?? '',
  };
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
    </div>
  );
}

function membershipBadgeClass(status: string) {
  if (status === 'Active') return 'bg-green-100 text-green-700';
  if (status === 'Rejected') return 'bg-red-100 text-red-700';
  if (status === 'Suspended') return 'bg-slate-200 text-slate-700';
  return 'bg-amber-100 text-amber-700';
}

function StudentDetailModal({
  studentId,
  onClose,
  onUpdated,
}: {
  studentId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<StudentEditForm | null>(null);
  const [error, setError] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [choosingPlan, setChoosingPlan] = useState(false);

  const { data: student, isLoading, refetch } = useQuery({
    queryKey: ['admin-student', studentId],
    queryFn: () => unwrap<StudentDetail>(api.get(`/admin/students/${studentId}`)),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['admin-students'] });
    qc.invalidateQueries({ queryKey: ['admin-student', studentId] });
    qc.invalidateQueries({ queryKey: ['verification-queue'] });
    onUpdated();
  };

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error('Nothing to save');
      if (form.membership_status === 'Rejected' && !form.reject_reason.trim()) {
        throw new Error('A reject reason is required when status is Rejected');
      }
      const age = form.age.trim() ? Number(form.age) : null;
      if (form.age.trim() && (!Number.isInteger(age) || age! < 0)) {
        throw new Error('Age must be a valid whole number');
      }
      return unwrap(api.patch(`/admin/students/${studentId}`, {
        full_name: form.full_name.trim(),
        age,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        dob: form.dob.trim() || null,
        gender: form.gender.trim() || null,
        address: form.address.trim() || null,
        state: form.state.trim() || null,
        district: form.district.trim() || null,
        pin_code: form.pin_code.trim() || null,
        about_me: form.about_me.trim() || null,
        membership_status: form.membership_status,
        cefr_status: form.cefr_status,
        cefr_level: form.cefr_level.trim() || null,
        reject_reason: form.reject_reason.trim() || null,
      }));
    },
    onSuccess: () => {
      setError('');
      setEditing(false);
      invalidateAll();
      refetch();
    },
    onError: (e: Error) => setError(e.message),
  });

  const approve = useMutation({
    mutationFn: (plan: string) => approveMembership(studentId, plan),
    onSuccess: () => {
      setError('');
      setChoosingPlan(false);
      invalidateAll();
      refetch();
    },
    onError: (e: Error) => setError(e.message),
  });

  const archive = useMutation({
    mutationFn: () =>
      unwrap(api.post(`/admin/students/${studentId}/archive`, null, {
        params: { reason: archiveReason.trim() },
      })),
    onSuccess: () => {
      setError('');
      invalidateAll();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const startEdit = () => {
    if (student) {
      setForm(studentToForm(student));
      setEditing(true);
    }
  };

  const setField = <K extends keyof StudentEditForm>(key: K, value: StudentEditForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  useEffect(() => {
    if (student && !editing) setForm(studentToForm(student));
  }, [student, editing]);

  if (isLoading || !student) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
        <div className="card w-full max-w-3xl">
          <p className="text-slate-500">{isLoading ? 'Loading student…' : 'Student not found.'}</p>
          <button className="btn-ghost mt-4" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const canApprove = student.membership_status === 'Pending Verification';

  return (
    <>
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-4">
            <StudentAvatar
              photoUrl={student.photo_url}
              gender={student.gender}
              name={student.full_name}
              size="h-16 w-16"
              iconSize={28}
            />
            <div>
              <h2 className="text-lg font-bold">{student.full_name}</h2>
              <p className="font-mono text-sm text-slate-500">{student.student_id}</p>
              <p className="text-xs text-slate-400">Joined {fmtDate(student.created_at)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!editing && (
              <button className="btn-ghost py-1 text-xs" onClick={startEdit}>Edit</button>
            )}
            <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`badge ${membershipBadgeClass(student.membership_status)}`}>
            {student.membership_status}
          </span>
          <span className="badge bg-slate-100 text-slate-600">{student.cefr_status}</span>
          {student.cefr_level && (
            <span className="badge bg-slate-100 text-slate-600">Level {student.cefr_level}</span>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {!editing ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2">
              <DetailRow label="Email" value={<EmailLink email={student.email} />} />
              <DetailRow label="Phone" value={<PhoneLink phone={student.phone} />} />
              <DetailRow label="WhatsApp" value={<PhoneLink phone={student.whatsapp} />} />
              <DetailRow label="Age" value={student.age ?? '—'} />
              <DetailRow label="Gender" value={student.gender || '—'} />
              <DetailRow label="Date of birth" value={student.dob || '—'} />
              <DetailRow label="Referral code" value={student.referral_code || '—'} />
              <DetailRow label="Verified" value={
                student.verified_at
                  ? `${fmtDate(student.verified_at)}${student.verified_by ? ` by ${student.verified_by}` : ''}`
                  : '—'
              } />
            </section>

            <section className="mt-6">
              <h3 className="text-sm font-semibold text-slate-700">Address</h3>
              <p className="mt-2 text-sm text-slate-600">
                {[student.address, student.district, student.state, student.pin_code].filter(Boolean).join(', ') || '—'}
              </p>
            </section>

            {student.about_me && (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-700">About</h3>
                <p className="mt-1 text-sm text-slate-600">{student.about_me}</p>
              </section>
            )}

            {student.reject_reason && (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-red-700">Reject reason</h3>
                <p className="mt-1 text-sm text-red-600">{student.reject_reason}</p>
              </section>
            )}

            {student.id_proof_url && (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-700">ID proof</h3>
                <a
                  href={student.id_proof_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-sm text-brand underline"
                >
                  View uploaded document
                </a>
              </section>
            )}

            {canApprove && (
              <section className="mt-8 border-t border-slate-200 pt-6">
                <button
                  className="btn-primary"
                  disabled={approve.isPending}
                  onClick={() => { setError(''); setChoosingPlan(true); }}
                >
                  Approve membership
                </button>
              </section>
            )}
          </>
        ) : (
          form && (
            <section className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Full name</label>
                <input className="input" value={form.full_name} onChange={(e) => setField('full_name', e.target.value)} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
              </div>
              <div>
                <label className="label">WhatsApp</label>
                <input className="input" value={form.whatsapp} onChange={(e) => setField('whatsapp', e.target.value)} />
              </div>
              <div>
                <label className="label">Age</label>
                <input className="input" type="number" min={0} value={form.age} onChange={(e) => setField('age', e.target.value)} />
              </div>
              <div>
                <label className="label">Gender</label>
                <input className="input" value={form.gender} onChange={(e) => setField('gender', e.target.value)} />
              </div>
              <div>
                <label className="label">Date of birth</label>
                <input className="input" value={form.dob} onChange={(e) => setField('dob', e.target.value)} />
              </div>
              <div>
                <label className="label">Membership status</label>
                <select className="input" value={form.membership_status} onChange={(e) => setField('membership_status', e.target.value)}>
                  {MEMBERSHIP_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">CEFR status</label>
                <select className="input" value={form.cefr_status} onChange={(e) => setField('cefr_status', e.target.value)}>
                  {CEFR_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">CEFR level</label>
                <select className="input" value={form.cefr_level} onChange={(e) => setField('cefr_level', e.target.value)}>
                  {CEFR_LEVELS.map((l) => (
                    <option key={l || 'none'} value={l}>{l || 'Not set'}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Address</label>
                <input className="input" value={form.address} onChange={(e) => setField('address', e.target.value)} />
              </div>
              <div>
                <label className="label">District</label>
                <input className="input" value={form.district} onChange={(e) => setField('district', e.target.value)} />
              </div>
              <div>
                <label className="label">State</label>
                <input className="input" value={form.state} onChange={(e) => setField('state', e.target.value)} />
              </div>
              <div>
                <label className="label">PIN code</label>
                <input className="input" value={form.pin_code} onChange={(e) => setField('pin_code', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">About me</label>
                <textarea className="input" rows={3} value={form.about_me} onChange={(e) => setField('about_me', e.target.value)} />
              </div>
              {form.membership_status === 'Rejected' && (
                <div className="sm:col-span-2">
                  <label className="label">Reject reason</label>
                  <input className="input" value={form.reject_reason} onChange={(e) => setField('reject_reason', e.target.value)} />
                </div>
              )}
              <div className="flex gap-2 sm:col-span-2">
                <button className="btn-primary" disabled={save.isPending} onClick={() => { setError(''); save.mutate(); }}>
                  {save.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </section>
          )
        )}

        {!editing && !student.is_archived && (
          <section className="mt-8 border-t border-slate-200 pt-6">
            <h3 className="text-sm font-semibold text-red-700">Archive student</h3>
            <p className="mt-1 text-xs text-slate-500">Soft-deletes the record with a 60-day retention period.</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="min-w-[16rem] flex-1">
                <label className="label">Reason</label>
                <input
                  className="input"
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  placeholder="Why is this student being archived?"
                />
              </div>
              <button
                className="btn-ghost border-red-200 text-red-600 hover:bg-red-50"
                disabled={archive.isPending || !archiveReason.trim()}
                onClick={() => {
                  if (!window.confirm(`Archive ${student.full_name}?`)) return;
                  setError('');
                  archive.mutate();
                }}
              >
                {archive.isPending ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
    {choosingPlan && (
      <ApprovePlanModal
        studentName={student.full_name}
        busy={approve.isPending}
        error={error}
        onClose={() => setChoosingPlan(false)}
        onConfirm={(plan) => approve.mutate(plan)}
      />
    )}
    </>
  );
}

function SubscriptionCell({ sub }: { sub?: SubSummary }) {
  if (!sub || sub.total === 0) return <span className="text-xs text-slate-400">—</span>;
  if (sub.active) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-100" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{sub.active.plan}</p>
          <p className="text-xs text-slate-500">until {fmtDay(sub.active.expires_at)}</p>
          {sub.past > 0 && <p className="text-[11px] text-slate-400">{sub.past} past</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300 ring-2 ring-slate-100" />
      <div>
        <p className="text-sm font-medium text-slate-500">Expired</p>
        {sub.past > 0 && <p className="text-[11px] text-slate-400">{sub.past} past</p>}
      </div>
    </div>
  );
}

export function AdminStudents() {
  const qc = useQueryClient();
  const [membership, setMembership] = useState('');
  const [viewStudentId, setViewStudentId] = useState<string | null>(null);
  const [approveFor, setApproveFor] = useState<Student | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-students'],
    queryFn: () =>
      unwrap<{ items: Student[]; total: number }>(api.get('/admin/students', { params: { page_size: 500 } })),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-students'] });

  const approve = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: string }) => approveMembership(id, plan),
    onSuccess: () => { setError(''); setApproveFor(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const reject = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt('Reason for rejection?');
      if (!reason) throw new Error('A reject reason is required');
      return unwrap(api.post(`/membership/${id}/reject`, null, { params: { reason } }));
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const renew = useMutation({
    mutationFn: (id: string) => {
      const days = Number(window.prompt('Extend active subscription by how many days?', '365'));
      if (!days || days < 1) throw new Error('Enter a valid number of days');
      return unwrap(api.post(`/membership/${id}/renew`, null, { params: { days } }));
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/admin/students/${id}`)),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const blockLogin = useMutation({
    mutationFn: ({ studentId, active }: { studentId: string; active: boolean }) =>
      unwrap(api.post(`/admin/users/${studentId}/${active ? 'unblock' : 'block'}`, active ? undefined : { reason: 'Blocked by admin' })),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const confirmDelete = (s: Student) => {
    if (
      !window.confirm(
        `Permanently delete ${s.full_name} (${s.student_id})?\n\nThis removes the student, login, subscriptions, payments, community data, and all other related records. This cannot be undone.`,
      )
    ) {
      return;
    }
    setError('');
    remove.mutate(s.student_id);
  };

  const rows = (data?.items ?? []).filter((s) => !membership || s.membership_status === membership);

  const columns: Column<Student>[] = [
    {
      key: 'full_name',
      header: 'Student',
      sort: (s) => s.full_name,
      cell: (s) => (
        <AdminStudentLink
          studentId={s.student_id}
          name={s.full_name}
          photoUrl={s.photo_url}
          gender={s.gender}
          avatarSize="h-10 w-10"
          subtitle={
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-[11px] text-slate-400">{s.student_id}</span>
              {s.email && <EmailLink email={s.email} className="block truncate text-[11px]" />}
            </span>
          }
        />
      ),
    },
    {
      key: 'membership_status',
      header: 'Membership',
      sort: (s) => s.membership_status,
      cell: (s) => <StatusBadge status={s.membership_status} />,
    },
    {
      key: 'cefr_status',
      header: 'CEFR',
      sort: (s) => s.cefr_status,
      cell: (s) => (
        <span
          className="inline-block max-w-[11rem] truncate rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
          title={s.cefr_status}
        >
          {s.cefr_status}
        </span>
      ),
    },
    {
      key: 'subscription',
      header: 'Subscription',
      sort: (s) => (s.subscription?.active ? 2 : s.subscription?.total ? 1 : 0),
      cell: (s) => <SubscriptionCell sub={s.subscription} />,
    },
    {
      key: 'login',
      header: 'Login',
      sort: (s) => (s.login_is_active ? 1 : 0),
      cell: (s) => {
        if (s.login_is_active == null) return <span className="text-slate-400">—</span>;
        return s.login_is_active
          ? <span className="badge bg-green-100 text-green-700">Active</span>
          : <span className="badge bg-red-100 text-red-700">Blocked</span>;
      },
    },
    {
      key: 'created_at',
      header: 'Joined',
      sort: (s) => s.created_at,
      cell: (s) => (
        <div>
          <p className="text-sm font-medium text-slate-700">{fmtDay(s.created_at)}</p>
          <p className="text-[11px] text-slate-400">{new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      className: 'whitespace-nowrap',
      cell: (s) => {
        const canBlock = s.login_is_active != null;
        const blocked = canBlock && s.login_is_active === false;
        return (
          <RowActions>
            {s.membership_status === 'Pending Verification' && (
              <>
                <RowAction
                  icon={Check}
                  label="Approve membership"
                  variant="success"
                  onClick={() => { setError(''); setApproveFor(s); }}
                />
                <RowAction
                  icon={X}
                  label="Reject membership"
                  variant="danger"
                  onClick={() => reject.mutate(s.student_id)}
                />
                <RowActionDivider />
              </>
            )}
            {s.membership_status === 'Active' && (
              <>
                <RowAction
                  icon={RefreshCw}
                  label="Renew subscription"
                  variant="primary"
                  onClick={() => renew.mutate(s.student_id)}
                />
                <RowActionDivider />
              </>
            )}
            <RowAction icon={Eye} label="View profile" to={`/admin/students/${s.student_id}`} />
            <RowAction icon={Pencil} label="Quick edit" onClick={() => setViewStudentId(s.student_id)} />
            {canBlock && (
              <>
                <RowActionDivider />
                {blocked ? (
                  <RowAction
                    icon={ShieldCheck}
                    label="Unblock login"
                    variant="success"
                    disabled={blockLogin.isPending}
                    onClick={() => {
                      if (window.confirm(`Unblock ${s.full_name}? They will be able to log in again.`)) {
                        blockLogin.mutate({ studentId: s.student_id, active: true });
                      }
                    }}
                  />
                ) : (
                  <RowAction
                    icon={Ban}
                    label="Block login"
                    variant="danger"
                    disabled={blockLogin.isPending}
                    onClick={() => {
                      if (window.confirm(`Block ${s.full_name}? They will not be able to log in.`)) {
                        blockLogin.mutate({ studentId: s.student_id, active: false });
                      }
                    }}
                  />
                )}
              </>
            )}
            <RowActionDivider />
            <RowAction
              icon={Trash2}
              label="Delete user"
              variant="danger"
              disabled={remove.isPending}
              onClick={() => confirmDelete(s)}
            />
          </RowActions>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title="Users & Memberships" description="All registered students — membership status, CEFR, subscriptions and verification actions." />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <DataTable
        rows={rows}
        columns={columns}
        loading={isLoading}
        rowKey={(s) => s.student_id}
        searchText={(s) => `${s.student_id} ${s.full_name} ${s.email ?? ''}`}
        searchPlaceholder="Search name / ID / email"
        initialSort={{ key: 'created_at', dir: 'desc' }}
        emptyLabel="No students found."
        filters={
          <TableFilter
            value={membership}
            onChange={setMembership}
            options={[{ value: '', label: 'All memberships' }, ...MEMBERSHIP_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        }
      />

      {viewStudentId && (
        <StudentDetailModal
          studentId={viewStudentId}
          onClose={() => setViewStudentId(null)}
          onUpdated={() => {}}
        />
      )}
      {approveFor && (
        <ApprovePlanModal
          studentName={approveFor.full_name}
          suggestedPlan={approveFor.subscription?.active?.plan}
          busy={approve.isPending}
          error={error}
          onClose={() => setApproveFor(null)}
          onConfirm={(plan) => approve.mutate({ id: approveFor.student_id, plan })}
        />
      )}
    </div>
  );
}
