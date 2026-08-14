import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { api, unwrap } from '@/lib/api';

/**
 * Free Demo Class registration. Every choice list — slots, their bookable
 * dates, education, occupation and attribution — comes from
 * `GET /leads/demo/options` so this form can never offer something the server
 * rejects (notably a preferred date that isn't on the chosen slot's weekday).
 */

interface Slot {
  label: string;
  weekday: string;
  dates: string[];
}

interface DemoOptions {
  slots: Slot[];
  education: string[];
  occupation: string[];
  heard_from: string[];
  kids_max_age: number;
}

interface DemoForm {
  name: string;
  phone: string;
  email?: string;
  age: number;
  education: string;
  occupation: string;
  demo_slot: string;
  demo_date: string;
  interest?: string;
  heard_from: string;
  heard_from_detail?: string;
  consent_privacy: boolean;
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export function DemoPage() {
  const { register, handleSubmit, watch, setValue, formState } = useForm<DemoForm>();
  const [done, setDone] = useState<DemoForm>();
  const [error, setError] = useState('');

  const { data: options, isLoading } = useQuery({
    queryKey: ['demo-options'],
    queryFn: () => unwrap<DemoOptions>(api.get('/leads/demo/options')),
  });

  const heardFrom = watch('heard_from');
  const chosenSlot = watch('demo_slot');
  const consented = watch('consent_privacy');
  const slot = options?.slots.find((s) => s.label === chosenSlot);

  async function onSubmit(values: DemoForm) {
    setError('');
    try {
      await unwrap(api.post('/leads/demo', {
        ...values,
        age: Number(values.age),
        heard_from_detail: values.heard_from === 'Other' ? values.heard_from_detail : undefined,
      }));
      setDone(values);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (done)
    return (
      <div className="card mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold text-brand">Thank you! 🎉</h1>
        <p className="mt-2 text-slate-600">Your free demo request is registered.</p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand/5 px-4 py-3 text-sm font-semibold text-brand">
          <CalendarClock size={16} /> {done.demo_slot}
          {done.demo_date ? ` · ${fmtDate(done.demo_date)}` : ''}
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Our team will contact you on {done.phone} to confirm your seat.
        </p>
      </div>
    );

  return (
    <div className="mx-auto max-w-lg">
      <p className="text-xs font-bold uppercase tracking-wide text-brand">
        Free Demo Class Registration
      </p>
      <h1 className="mt-1 text-3xl font-extrabold">Book Your Free Demo Class</h1>
      <p className="mt-2 text-slate-600">
        Experience the SpeakEdge™ NRP Method and discover how SpeakEdge can help you develop
        confident English communication.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="card mt-6 space-y-4">
        <div>
          <label className="label">Full name *</label>
          <input className="input" {...register('name', { required: true })} />
        </div>
        <div>
          <label className="label">Mobile number *</label>
          <input className="input" {...register('phone', { required: true })} />
        </div>
        <div>
          <label className="label">Email (optional)</label>
          <input className="input" type="email" {...register('email')} />
        </div>

        <div>
          <label className="label">Age *</label>
          <input
            className="input"
            type="number"
            min={3}
            max={100}
            {...register('age', { required: true, valueAsNumber: true })}
          />
          <p className="mt-1 text-xs text-slate-500">
            This helps us place the learner in the appropriate Kids or Adult demo group.
          </p>
        </div>

        <div>
          <label className="label">Current education / academic qualification *</label>
          <select className="input" defaultValue="" {...register('education', { required: true })}>
            <option value="" disabled>Select…</option>
            {(options?.education ?? []).map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Occupation *</label>
          <select className="input" defaultValue="" {...register('occupation', { required: true })}>
            <option value="" disabled>Select…</option>
            {(options?.occupation ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        <fieldset>
          <legend className="label">Choose your demo class slot *</legend>
          <div className="mt-1 space-y-2">
            {(options?.slots ?? []).map((s) => (
              <label
                key={s.label}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand/40 hover:bg-brand/5 has-[:checked]:border-brand has-[:checked]:bg-brand/5 has-[:checked]:text-brand"
              >
                <input
                  type="radio"
                  value={s.label}
                  {...register('demo_slot', { required: true })}
                  // Changing slot invalidates any date picked for the old one.
                  onChange={(e) => {
                    setValue('demo_slot', e.target.value, { shouldValidate: true });
                    setValue('demo_date', '');
                  }}
                />
                <CalendarClock size={16} className="shrink-0 text-slate-400" />
                {s.label}
              </label>
            ))}
          </div>
          {isLoading && <p className="mt-1 text-sm text-slate-400">Loading slots…</p>}
          {formState.errors.demo_slot && (
            <p className="mt-1 text-sm text-red-600">Please pick a slot.</p>
          )}
        </fieldset>

        <div>
          <label className="label">Preferred demo date *</label>
          <select
            className="input"
            defaultValue=""
            disabled={!slot}
            {...register('demo_date', { required: true })}
          >
            <option value="" disabled>
              {slot ? 'Select a date…' : 'Choose a slot first'}
            </option>
            {(slot?.dates ?? []).map((d) => (
              <option key={d} value={d}>{fmtDate(d)}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Only dates matching your chosen {slot ? slot.weekday : ''} slot are listed.
          </p>
        </div>

        <div>
          <label className="label">What would you most like to improve? (optional)</label>
          <input
            className="input"
            placeholder="Speaking confidence, fluency, vocabulary, pronunciation…"
            {...register('interest')}
          />
          <p className="mt-1 text-xs text-slate-500">
            For example: speaking confidence, fluency, vocabulary, pronunciation, public speaking or
            overall communication.
          </p>
        </div>

        <div>
          <label className="label">How did you hear about SpeakEdge? *</label>
          <select className="input" defaultValue="" {...register('heard_from', { required: true })}>
            <option value="" disabled>Select…</option>
            {(options?.heard_from ?? []).map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        {heardFrom === 'Other' && (
          <div>
            <label className="label">Please tell us more *</label>
            <input className="input" {...register('heard_from_detail', { required: true })} />
          </div>
        )}

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            {...register('consent_privacy', { required: true })}
          />
          <span>
            I agree to the{' '}
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand underline underline-offset-2 hover:text-brand-light"
            >
              Privacy Policy
            </Link>{' '}
            and consent to being contacted by SpeakEdge regarding my Free Demo Class and related
            enquiry. *
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={formState.isSubmitting || !consented}>
          Book My Free Demo Class
        </button>
      </form>
    </div>
  );
}
