import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';

interface Status {
  student_id: string;
  membership_status: string;
  reject_reason?: string | null;
}

export function StatusPage() {
  const { studentId } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['status', studentId],
    queryFn: () => unwrap<Status>(api.get(`/membership/status/${studentId}`)),
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto max-w-lg text-center">
      <div className="card">
        <div className="text-sm uppercase tracking-wide text-slate-400">Your Student ID</div>
        <div className="mt-1 text-2xl font-extrabold text-brand">{studentId}</div>

        {isLoading ? (
          <p className="mt-6 text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="mt-6">
              {data?.membership_status === 'Active' ? (
                <span className="badge bg-green-100 text-green-700">Active ✓</span>
              ) : data?.membership_status === 'Rejected' ? (
                <span className="badge bg-red-100 text-red-700">Rejected</span>
              ) : (
                <span className="badge bg-amber-100 text-amber-700">Verification Pending</span>
              )}
            </div>
            {data?.membership_status === 'Pending Verification' && (
              <p className="mt-4 text-slate-600">
                Our team verifies memberships within <b>72 hours</b>. You can log in now with limited access.
              </p>
            )}
            {data?.membership_status === 'Rejected' && (
              <p className="mt-4 text-red-600">Reason: {data.reject_reason}</p>
            )}
            {data?.membership_status === 'Active' && (
              <p className="mt-4 text-slate-600">You're verified! Head to your dashboard.</p>
            )}
          </>
        )}
        <Link to="/login" className="btn-primary mt-6 inline-flex">Go to Login</Link>
      </div>
    </div>
  );
}
