const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/**
 * Silver through Diamond Pro carry a monthly fee on top of the one-time
 * admission fee. Those tiers collect the first month with the admission fee by
 * default, so a new learner walks into their first class with nothing left to
 * pay — but paying the admission fee alone stays one click away.
 *
 * Renders nothing on plans without a monthly fee (Tribe, Basic), where there is
 * no choice to make. The server prices the order either way; this only sends
 * the buyer's choice.
 */
export function FirstMonthChoice({
  monthlyFee,
  admission,
  value,
  onChange,
}: {
  /** Plan's monthly fee in paise; 0 hides the whole block. */
  monthlyFee: number;
  /** One-time admission fee in paise, for the two totals shown. */
  admission: number;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  if (monthlyFee <= 0) return null;

  const options: { include: boolean; title: string; hint: string; total: number }[] = [
    {
      include: true,
      title: 'Admission fee + first month fee',
      hint: 'Recommended — nothing more to pay when your classes begin.',
      total: admission + monthlyFee,
    },
    {
      include: false,
      title: 'Admission fee only',
      hint: `Your first ${rupees(monthlyFee)} monthly fee is billed a month after your class start date.`,
      total: admission,
    },
  ];

  return (
    <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <legend className="px-1 text-sm font-bold text-slate-900">First month fee</legend>
      <div className="mt-1 grid gap-2">
        {options.map((o) => (
          <label
            key={String(o.include)}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 text-sm transition ${
              value === o.include ? 'border-brand ring-1 ring-brand/30' : 'border-slate-200'
            }`}
          >
            <input
              type="radio"
              name="include_first_month"
              className="mt-1 h-4 w-4 shrink-0"
              checked={value === o.include}
              onChange={() => onChange(o.include)}
            />
            <span className="flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-slate-900">{o.title}</span>
                <span className="font-bold tabular-nums text-slate-900">{rupees(o.total)}</span>
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
