import { PageHeader, StatusBadge } from '@/features/admin/_shared';
import { usePartnerDashboard } from './PartnerHome';

export function PartnerProfilePage() {
  const { data, isLoading } = usePartnerDashboard();

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (!data) return <p className="text-slate-500">No partner profile linked to this account.</p>;

  return (
    <div>
      <PageHeader title="My Profile" description="Managed by the SpeakEdge admin team." actions={<StatusBadge status={data.status} />} />
      <div className="card mt-6 max-w-lg space-y-2 text-sm">
        <Row label="Partner ID" value={data.partner_id || 'Pending approval'} />
        <Row label="Contact person" value={data.name} />
        <Row label="Partner type" value={data.partner_type} />
        <Row label="Products allowed" value={data.products_allowed.join(', ') || '—'} />
      </div>
      <p className="mt-3 text-xs text-slate-400">
        To update your details, contact the admin team or WhatsApp support.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}
