import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export function UpgradePlanCta() {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 border-brand/20 bg-brand/5">
      <div>
        <p className="font-semibold text-slate-800">Need more classes or a longer plan?</p>
        <p className="mt-1 text-sm text-slate-500">Compare all plans and upgrade without losing your membership.</p>
      </div>
      <Link to="/plans" className="btn-primary inline-flex items-center gap-2">
        Upgrade plan <ArrowRight size={16} />
      </Link>
    </div>
  );
}
