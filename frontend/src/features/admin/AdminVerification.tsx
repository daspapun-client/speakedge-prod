import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { AdminStudentLink, EmailLink, PhoneLink } from './_shared';

interface PendingStudent {
  student_id: string;
  full_name: string;
  email?: string;
  phone?: string;
  photo_url?: string | null;
  id_proof_url?: string | null;
  id_proof_type?: string | null;
  id_proof_number?: string | null;
  audience?: string;
  created_at: string;
}

export function AdminVerification() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['verification-queue'],
    queryFn: () => unwrap<PendingStudent[]>(api.get('/admin/verification-queue')),
  });

  const approve = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/membership/${id}/approve`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verification-queue'] }),
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
            const approving = approve.isPending && approve.variables === s.student_id;
            const rejecting = reject.isPending && reject.variables?.id === s.student_id;
            const busy = approving || rejecting;
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
                    <span>
                      {s.id_proof_type ?? 'ID proof type not recorded'}
                      {s.id_proof_number ? ` · ${s.id_proof_number}` : ''}
                    </span>
                    {s.id_proof_url && (
                      <a href={s.id_proof_url} target="_blank" rel="noreferrer" className="text-brand underline">
                        View document
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary inline-flex items-center gap-2"
                    disabled={busy}
                    onClick={() => approve.mutate(s.student_id)}
                  >
                    {approving ? <Loader2 size={16} className="animate-spin" /> : null}
                    {approving ? 'Approving…' : 'Approve'}
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
    </div>
  );
}
