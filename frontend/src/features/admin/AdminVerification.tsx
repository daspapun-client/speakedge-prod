import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { AdminStudentLink, ApprovePlanModal, EmailLink, PhoneLink, approveMembership } from './_shared';

interface PendingStudent {
  student_id: string;
  full_name: string;
  email?: string;
  phone?: string;
  photo_url?: string | null;
  id_proof_url?: string | null;
  id_proof_type?: string | null;
  education_level?: string | null;
  education_proof_url?: string | null;
  age?: number | null;
  audience?: string;
  /** Plan already stamped on the activation code or an existing subscription. */
  plan?: string | null;
  guardian_name?: string | null;
  guardian_relationship?: string | null;
  guardian_phone?: string | null;
  created_at: string;
}

export function AdminVerification() {
  const qc = useQueryClient();
  const [approving, setApproving] = useState<PendingStudent | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['verification-queue'],
    queryFn: () => unwrap<PendingStudent[]>(api.get('/admin/verification-queue')),
  });

  const approve = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: string }) => approveMembership(id, plan),
    onSuccess: () => {
      setApproving(null);
      qc.invalidateQueries({ queryKey: ['verification-queue'] });
    },
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(api.post(`/membership/${id}/reject`, null, { params: { reason } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verification-queue'] }),
  });

  return (
    <div>
      <h1 className="text-2xl font-extrabold">Verification Queue (72h SLA)</h1>
      {isLoading ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : !data?.length ? (
        <p className="mt-6 text-slate-500">Nothing pending. 🎉</p>
      ) : (
        <div className="mt-6 space-y-4">
          {data.map((s) => {
            const rejecting = reject.isPending && reject.variables?.id === s.student_id;
            const busy = approve.isPending || rejecting;
            return (
              <div key={s.student_id} className="card flex flex-wrap items-center gap-4">
                <AdminStudentLink
                  studentId={s.student_id}
                  name={s.full_name}
                  photoUrl={s.photo_url}
                  avatarSize="h-14 w-14"
                  iconSize={24}
                />
                <div className="flex-1 min-w-[12rem]">
                  <div className="text-sm text-slate-500">{s.student_id} · {s.email ? <EmailLink email={s.email} className="text-sm" /> : 'no email'}{s.phone ? <> · <PhoneLink phone={s.phone} className="text-sm" /></> : ''}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className={`badge ${s.audience === 'kids' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                      {s.audience === 'kids' ? 'Kids' : 'Adults'}
                    </span>
                    {s.age != null && (
                      <span className={`badge ${s.age < 18 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                        Age {s.age}{s.age < 18 ? ' · minor' : ''}
                      </span>
                    )}
                    <span>
                      {s.id_proof_type ?? 'ID proof type not recorded'}
                    </span>
                    {s.id_proof_url && (
                      <a href={s.id_proof_url} target="_blank" rel="noreferrer" className="text-brand underline">
                        View ID proof
                      </a>
                    )}
                    <span>{s.education_level ?? 'Academic background not recorded'}</span>
                    {s.education_proof_url && (
                      <a href={s.education_proof_url} target="_blank" rel="noreferrer" className="text-brand underline">
                        View academic proof
                      </a>
                    )}
                  </div>
                  {s.guardian_name && (
                    <div className="mt-1 text-xs text-amber-800">
                      Guardian: {s.guardian_name}
                      {s.guardian_relationship ? ` (${s.guardian_relationship})` : ''}
                      {s.guardian_phone ? ` · ${s.guardian_phone}` : ''} · consent recorded
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary inline-flex items-center gap-2"
                    disabled={busy}
                    onClick={() => { approve.reset(); setApproving(s); }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn-ghost inline-flex items-center gap-2 text-red-600"
                    disabled={busy}
                    onClick={() => {
                      const reason = prompt('Reject reason?') || 'Not specified';
                      reject.mutate({ id: s.student_id, reason });
                    }}
                  >
                    {rejecting ? <Loader2 size={16} className="animate-spin" /> : null}
                    {rejecting ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {approving && (
        <ApprovePlanModal
          studentName={approving.full_name}
          suggestedPlan={approving.plan}
          busy={approve.isPending}
          error={approve.error instanceof Error ? approve.error.message : undefined}
          onClose={() => setApproving(null)}
          onConfirm={(plan) => approve.mutate({ id: approving.student_id, plan })}
        />
      )}
    </div>
  );
}
