import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Terms & Conditions block shown before any payment. The backend refuses an
 * order whose `accept_terms` is false, so this is the gate — not a formality:
 * callers must keep the Pay button disabled until `checked` is true.
 */

function PolicyLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-brand underline underline-offset-2 hover:text-brand-light"
    >
      {children}
    </Link>
  );
}

export function TermsAgreement({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      {/* Just the acceptance line — the policies themselves are one click away
          rather than restated as a wall of bullets above the Pay button. */}
      <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          I have read and agree to the <PolicyLink to="/terms">Terms &amp; Conditions</PolicyLink>,{' '}
          <PolicyLink to="/privacy">Privacy Policy</PolicyLink> and{' '}
          <PolicyLink to="/refund-policy">Cancellation &amp; Refund Policy</PolicyLink>.
        </span>
      </label>
    </section>
  );
}

/**
 * The same gate as a blocking dialog, for payment flows that jump straight to
 * the gateway (plan renewal, accepting a priced offer) and have no form to
 * host the checkbox.
 */
export function TermsGateModal({
  open,
  title,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [checked, setChecked] = useState(false);

  // Each time the dialog opens the learner must tick the box again.
  useEffect(() => {
    if (open) setChecked(false);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <div className="mt-4">
          <TermsAgreement checked={checked} onChange={setChecked} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!checked} onClick={onConfirm}>
            Agree &amp; Continue to Payment
          </button>
        </div>
      </div>
    </div>
  );
}
