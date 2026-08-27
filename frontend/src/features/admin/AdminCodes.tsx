import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Trash2, Unlock, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import {
  ACTIVATION_CONSENTS,
  GuardianFields,
  PRIVATE_DOC_NOTE,
  SectionNotice,
  ageFromDob,
  sectionFor,
  useActivationOptions,
} from '@/features/membership/ActivatePage';
import { AdminStudentLink, Column, DataTable, Modal, RowAction, RowActionDivider, RowActions, StatCard, TableFilter, downloadExport } from './_shared';

interface Code {
  code: string;
  status: string;
  /** Course the code enrols into — becomes the student's fixed audience. */
  audience?: 'adults' | 'kids';
  batch_id?: string;
  created_at: string;
  activated_student_id?: string | null;
  activated_student_name?: string | null;
  activated_student_photo_url?: string | null;
  activated_student_gender?: string | null;
}

interface Stats {
  total_generated: number;
  unused: number;
  activated: number;
  blocked: number;
  activation_percentage: number;
}

const codeBadgeClass = (status: string) =>
  status === 'unused'
    ? 'bg-slate-100 text-slate-600'
    : status === 'activated'
    ? 'bg-green-100 text-green-700'
    : status === 'blocked'
    ? 'bg-red-100 text-red-700'
    : 'bg-amber-100 text-amber-700';

const canDelete = (status: string) => status === 'unused' || status === 'blocked';

function ManualEnrollModal({
  code,
  onClose,
  onDone,
}: {
  code: Code;
  onClose: () => void;
  onDone: () => void;
}) {
  const options = useActivationOptions();
  const [error, setError] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string>();
  const [guardianConsent, setGuardianConsent] = useState(false);
  // Age is derived from the date of birth, exactly as on the public form.
  const [age, setAge] = useState<number | null>(null);

  const derived = sectionFor(age, options);
  const isMinor = derived?.eligible === true && derived.minor;
  const blocked = derived?.eligible === false;

  const enroll = useMutation({
    mutationFn: (form: FormData) => unwrap(api.post('/activation-codes/manual-activate', form)),
    onSuccess: () => {
      setError('');
      onDone();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const form = new FormData(e.currentTarget);
    form.set('code', code.code);
    const agreed = !!form.get('consent_all');
    for (const name of ACTIVATION_CONSENTS) {
      form.set(name, agreed ? 'true' : 'false');
    }
    form.delete('consent_all');
    form.set('consent_guardian', isMinor && guardianConsent ? 'true' : 'false');
    if (!form.get('cefr_level')) form.delete('cefr_level');
    enroll.mutate(form);
  }

  return (
    <Modal wide onClose={onClose}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Enroll new student</h2>
          <p className="mt-1 text-sm text-slate-500">Manual activation — same as the public registration form.</p>
        </div>
        <button type="button" className="btn-ghost py-1 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mt-3 font-mono text-sm font-semibold text-brand">{code.code}</p>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Full name *</label>
          <input name="full_name" className="input" required autoFocus />
        </div>
        <div>
          <label className="label">Create Password *</label>
          <input name="password" type="password" className="input" minLength={6} required />
          <p className="mt-1 text-xs text-slate-500">Minimum 6 characters</p>
        </div>
        <div className="md:col-span-2">
          <label className="label">Date of Birth *</label>
          <input
            name="dob"
            type="date"
            className="input"
            required
            onChange={(e) => setAge(ageFromDob(e.target.value))}
          />
          <SectionNotice age={age} options={options} />
        </div>
        <div>
          <label className="label">Gender *</label>
          <select name="gender" className="input" required defaultValue="">
            <option value="" disabled>Select…</option>
            <option>Male</option>
            <option>Female</option>
            <option>Other</option>
          </select>
        </div>
        <div>
          <label className="label">Mobile number *</label>
          <input name="phone" className="input" required />
        </div>
        <div>
          <label className="label">WhatsApp Number (Optional)</label>
          <input name="whatsapp" className="input" />
        </div>
        <div>
          <label className="label">Email</label>
          <input name="email" type="email" className="input" />
        </div>
        <div className="md:col-span-2">
          <label className="label">Full address *</label>
          <textarea name="address" className="input" rows={2} required />
        </div>
        <div>
          <label className="label">State *</label>
          <input name="state" className="input" required />
        </div>
        <div>
          <label className="label">District *</label>
          <input name="district" className="input" required />
        </div>
        <div>
          <label className="label">PIN code *</label>
          <input name="pin_code" className="input" required />
        </div>
        <div>
          <label className="label">Self-declared CEFR Speaking Level</label>
          <select name="cefr_level" className="input" defaultValue="">
            <option value="">Prefer not to say</option>
            {options.cefr_levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Academic / Educational Background *</label>
          <select name="education_level" className="input" required defaultValue="">
            <option value="" disabled>Select…</option>
            {options.academic_levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">About Me (Optional – within 100 words)</label>
          <textarea name="about_me" className="input" rows={2} />
        </div>
        <div>
          <label className="label">Profile photo *</label>
          <input
            name="photo"
            type="file"
            accept="image/*"
            className="input"
            required
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPhotoPreview(URL.createObjectURL(f));
            }}
          />
          {photoPreview && <img src={photoPreview} alt="preview" className="mt-2 h-16 w-16 rounded object-cover" />}
        </div>
        <div>
          <label className="label">Identity Proof *</label>
          <select name="id_proof_type" className="input" required defaultValue="">
            <option value="" disabled>Select a document…</option>
            {options.id_proof_types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Required for identity and membership verification.
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="label">Upload Identity Proof *</label>
          <input name="id_proof" type="file" accept="image/*,application/pdf" className="input" required />
          <p className="mt-1 text-xs text-slate-500">{PRIVATE_DOC_NOTE}</p>
        </div>
        <div className="md:col-span-2">
          <label className="label">Upload Academic / Educational Proof *</label>
          <input name="education_proof" type="file" accept="image/*,application/pdf" className="input" required />
          <p className="mt-1 text-xs text-slate-500">
            School, college, academic or educational document verifying the stated background.{' '}
            {PRIVATE_DOC_NOTE}
          </p>
        </div>
        {isMinor && (
          <GuardianFields
            options={options}
            consent={guardianConsent}
            onConsentChange={setGuardianConsent}
          />
        )}
        <div className="md:col-span-2">
          <label className="label">Reason (optional, logged)</label>
          <input name="reason" className="input" placeholder="Why is this being enrolled manually?" />
        </div>
        <fieldset className="md:col-span-2 border-t border-slate-200 pt-3">
          <legend className="label mb-1">Terms &amp; consent (required)</legend>
          <label className="flex items-start gap-2 text-sm">
            <input name="consent_all" type="checkbox" required className="mt-0.5" />
            The learner has read and agreed to the Terms &amp; Conditions, Privacy Policy, Speaking
            Community Rules, Community Safety Policy, applicable Cancellation &amp; Refund Policy,
            and the membership verification process. *
          </label>
        </fieldset>
        {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
        <div className="md:col-span-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={enroll.isPending || blocked || (isMinor && !guardianConsent)}
          >
            {enroll.isPending ? 'Enrolling…' : 'Enroll student'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminCodes() {
  const qc = useQueryClient();
  const [count, setCount] = useState(100);
  // Kids and Adults are separate courses. A batch of codes is issued for one of
  // them, and that is what fixes the student's course at activation.
  const [audience, setAudience] = useState<'adults' | 'kids'>('adults');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [enrollTarget, setEnrollTarget] = useState<Code | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['codes'],
    queryFn: () =>
      unwrap<{ items: Code[]; total: number }>(api.get('/activation-codes/', { params: { page_size: 500 } })),
  });

  const { data: stats } = useQuery({
    queryKey: ['code-stats'],
    queryFn: () => unwrap<Stats>(api.get('/activation-codes/stats')),
  });

  const gen = useMutation({
    mutationFn: () =>
      unwrap<{ generated: number }>(api.post('/activation-codes/generate', { count, audience })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['codes'] }); qc.invalidateQueries({ queryKey: ['code-stats'] }); },
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['codes'] }); qc.invalidateQueries({ queryKey: ['code-stats'] }); };

  const setStatus = useMutation({
    mutationFn: ({ code, status }: { code: string; status: string }) => {
      const reason = status === 'blocked' ? window.prompt('Reason for blocking?', '') || undefined : undefined;
      return unwrap(api.post('/activation-codes/status', { code, status, reason }));
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (code: string) => unwrap(api.delete(`/activation-codes/${encodeURIComponent(code)}`)),
    onSuccess: (_data, code) => {
      setSelected((cur) => {
        const next = new Set(cur);
        next.delete(code);
        return next;
      });
      refresh();
    },
  });

  const bulkRemove = useMutation({
    mutationFn: (codes: string[]) =>
      unwrap<{ deleted: number; codes: string[]; skipped: { code: string; reason: string }[] }>(
        api.post('/activation-codes/bulk-delete', { codes }),
      ),
    onSuccess: (data) => {
      setSelected(new Set());
      refresh();
      if (data.skipped.length) {
        window.alert(`Deleted ${data.deleted}. Skipped ${data.skipped.length} (activated/reserved or not found).`);
      }
    },
  });

  const filteredRows = useMemo(
    () => (data?.items ?? []).filter((c) => !statusFilter || c.status === statusFilter),
    [data?.items, statusFilter],
  );
  const deletableRows = useMemo(() => filteredRows.filter((c) => canDelete(c.status)), [filteredRows]);
  const allDeletableSelected =
    deletableRows.length > 0 && deletableRows.every((c) => selected.has(c.code));

  const toggleOne = (code: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleAllDeletable = () => {
    if (allDeletableSelected) {
      setSelected((cur) => {
        const next = new Set(cur);
        deletableRows.forEach((c) => next.delete(c.code));
        return next;
      });
    } else {
      setSelected((cur) => {
        const next = new Set(cur);
        deletableRows.forEach((c) => next.add(c.code));
        return next;
      });
    }
  };

  const confirmDelete = (code: string) => {
    if (!window.confirm(`Delete activation code ${code}? It can be restored from Archive for 60 days.`)) return;
    remove.mutate(code);
  };

  const confirmBulkDelete = () => {
    const codes = [...selected];
    if (!codes.length) return;
    if (!window.confirm(`Delete ${codes.length} activation code(s)? Restorable from Archive for 60 days.`)) return;
    bulkRemove.mutate(codes);
  };

  const columns: Column<Code>[] = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          className="accent-brand"
          checked={allDeletableSelected}
          disabled={!deletableRows.length}
          onChange={toggleAllDeletable}
          aria-label="Select all deletable codes"
        />
      ),
      width: '1%',
      className: 'w-10',
      cell: (c) =>
        canDelete(c.status) ? (
          <input
            type="checkbox"
            className="accent-brand"
            checked={selected.has(c.code)}
            onChange={() => toggleOne(c.code)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${c.code}`}
          />
        ) : null,
    },
    { key: 'code', header: 'Code', sort: (c) => c.code, cell: (c) => <span className="font-mono font-semibold">{c.code}</span> },
    { key: 'status', header: 'Status', sort: (c) => c.status, cell: (c) => <span className={`badge ${codeBadgeClass(c.status)}`}>{c.status}</span> },
    {
      key: 'audience',
      header: 'Course',
      sort: (c) => c.audience ?? 'adults',
      cell: (c) => (
        <span className={`badge ${c.audience === 'kids' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
          {c.audience === 'kids' ? 'Kids' : 'Adults'}
        </span>
      ),
    },
    { key: 'activated_student_id', header: 'Student', sort: (c) => c.activated_student_id ?? '', cell: (c) => (
      c.activated_student_id ? (
        <AdminStudentLink
          studentId={c.activated_student_id}
          name={c.activated_student_name}
          photoUrl={c.activated_student_photo_url}
          gender={c.activated_student_gender}
        />
      ) : '—'
    ) },
    { key: 'created_at', header: 'Created', sort: (c) => c.created_at, cell: (c) => <span className="text-slate-500">{new Date(c.created_at).toLocaleDateString()}</span> },
    {
      key: 'actions',
      header: '',
      width: '1%',
      className: 'whitespace-nowrap',
      cell: (c) => {
        const showEnroll = !c.activated_student_id;
        const showStatus = c.status === 'blocked' || c.status !== 'activated';
        const showDelete = canDelete(c.status);
        if (!showEnroll && !showStatus && !showDelete) return '—';

        return (
          <RowActions>
            {c.status === 'blocked' ? (
              <RowAction
                icon={Unlock}
                label="Unblock code"
                variant="success"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ code: c.code, status: 'unused' })}
              />
            ) : c.status !== 'activated' ? (
              <RowAction
                icon={Ban}
                label="Block code"
                variant="danger"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ code: c.code, status: 'blocked' })}
              />
            ) : null}
            {showEnroll && (
              <>
                {showStatus && <RowActionDivider />}
                <RowAction
                  icon={UserPlus}
                  label="Enroll student"
                  variant="primary"
                  onClick={() => setEnrollTarget(c)}
                />
              </>
            )}
            {showDelete && (
              <>
                {(showStatus || showEnroll) && <RowActionDivider />}
                <RowAction
                  icon={Trash2}
                  label="Delete code"
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => confirmDelete(c.code)}
                />
              </>
            )}
          </RowActions>
        );
      },
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-extrabold">Activation Codes</h1>

      {stats && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total generated" value={stats.total_generated} />
          <StatCard label="Unused" value={stats.unused} />
          <StatCard label="Activated" value={stats.activated} hint={`${stats.activation_percentage}% activation`} />
          <StatCard label="Blocked" value={stats.blocked} />
        </div>
      )}

      <div className="card mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Quantity</label>
          <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 100, 500, 1000, 5000].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Course</label>
          <select
            className="input"
            value={audience}
            onChange={(e) => setAudience(e.target.value as 'adults' | 'kids')}
          >
            <option value="adults">Adults</option>
            <option value="kids">Kids</option>
          </select>
        </div>
        <button className="btn-primary" onClick={() => gen.mutate()} disabled={gen.isPending}>
          {gen.isPending ? 'Generating…' : 'Generate batch'}
        </button>
        <button className="btn-ghost" onClick={() => downloadExport('/activation-codes/export', { format: 'csv' }, 'activation_codes.csv')}>
          Export CSV
        </button>
        <button className="btn-ghost" onClick={() => downloadExport('/activation-codes/export', { format: 'xlsx' }, 'activation_codes.xlsx')}>
          Export Excel
        </button>
        {gen.isSuccess && <span className="text-sm text-green-600">Generated {gen.data.generated} codes ✓</span>}
      </div>

      <DataTable
        rows={filteredRows}
        columns={columns}
        loading={isLoading}
        rowKey={(c) => c.code}
        searchText={(c) => `${c.code} ${c.activated_student_id ?? ''}`}
        searchPlaceholder="Search code / student ID"
        initialSort={{ key: 'created_at', dir: 'desc' }}
        pageSize={25}
        emptyLabel="No activation codes yet."
        filters={
          <>
            <TableFilter
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setSelected(new Set());
              }}
              options={['', 'unused', 'reserved', 'activated', 'blocked'].map((s) => ({
                value: s,
                label: s || 'All statuses',
              }))}
            />
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-600">{selected.size} selected</span>
                <button
                  type="button"
                  className="btn-ghost py-1.5 text-xs text-red-600 hover:bg-red-50"
                  disabled={bulkRemove.isPending}
                  onClick={confirmBulkDelete}
                >
                  {bulkRemove.isPending ? 'Deleting…' : 'Delete selected'}
                </button>
                <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
            )}
          </>
        }
      />
      {enrollTarget && (
        <ManualEnrollModal code={enrollTarget} onClose={() => setEnrollTarget(null)} onDone={refresh} />
      )}
    </div>
  );
}
