import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, unwrap } from '@/lib/api';

const PARTNER_TYPES = [
  'Individual Partner',
  'Educational Institute Partner',
  'Book Store / Shop Partner',
  'Complete Sujyoti Franchisee Partner',
];

const INTERESTS = ['SpeakEdge', 'Sujyoti Language School', 'Sujyoti Publications', 'Franchisee', 'All'];

interface ApplyForm {
  partner_type: string;
  name: string;
  org?: string;
  phone: string;
  whatsapp: string;
  email?: string;
  state: string;
  district: string;
  area: string;
}

export function PartnerApplyPage() {
  const { register, handleSubmit, formState } = useForm<ApplyForm>({
    defaultValues: { partner_type: 'Individual Partner' },
  });
  const [interested, setInterested] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  function toggle(v: string) {
    setInterested((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  }

  async function onSubmit(values: ApplyForm) {
    setError('');
    if (!consent) {
      setError('Please agree to be contacted by the Sujyoti EdTech team.');
      return;
    }
    try {
      await unwrap(api.post('/partner/apply', {
        ...values,
        email: values.email || null,
        org: values.org || null,
        interested_in: interested,
        consent_contact: consent,
      }));
      setDone('Thank you. Your partnership application has been received. Our team will contact you shortly.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (done)
    return (
      <div className="card mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold text-brand">Application received 🎉</h1>
        <p className="mt-2 text-slate-600">{done}</p>
      </div>
    );

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl font-extrabold">Become a Partner</h1>
      <p className="mt-2 text-slate-600">Join the Sujyoti EdTech Partner Network.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="card mt-6 space-y-4">
        <div>
          <label className="label">Partner type</label>
          <select className="input" {...register('partner_type', { required: true })}>
            {PARTNER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Contact person</label>
            <input className="input" {...register('name', { required: true })} />
          </div>
          <div>
            <label className="label">Organisation (optional)</label>
            <input className="input" {...register('org')} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Phone</label>
            <input className="input" {...register('phone', { required: true })} />
          </div>
          <div>
            <label className="label">WhatsApp</label>
            <input className="input" {...register('whatsapp', { required: true })} />
          </div>
        </div>
        <div>
          <label className="label">Email (optional)</label>
          <input className="input" type="email" {...register('email')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">State</label>
            <input className="input" {...register('state', { required: true })} />
          </div>
          <div>
            <label className="label">District</label>
            <input className="input" {...register('district', { required: true })} />
          </div>
          <div>
            <label className="label">Area</label>
            <input className="input" {...register('area', { required: true })} />
          </div>
        </div>
        <div>
          <label className="label">Interested in</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {INTERESTS.map((i) => (
              <button
                type="button"
                key={i}
                onClick={() => toggle(i)}
                className={`rounded-full px-3 py-1 text-sm ${interested.includes(i) ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          I agree to be contacted by the Sujyoti EdTech team.
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={formState.isSubmitting}>
          Submit application
        </button>
      </form>
    </div>
  );
}
