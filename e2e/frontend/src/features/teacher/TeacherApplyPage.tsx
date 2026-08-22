import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, unwrap } from '@/lib/api';

interface ApplyForm {
  name: string;
  phone: string;
  whatsapp: string;
  email: string;
  city: string;
  qualification: string;
  cefr_level: string;
  experience?: string;
  username: string;
  password: string;
  bio?: string;
}

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Not Tested'];

export function TeacherApplyPage() {
  const { register, handleSubmit, formState } = useForm<ApplyForm>({ defaultValues: { cefr_level: 'Not Tested' } });
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(values: ApplyForm) {
    setError('');
    try {
      const res = await unwrap<{ id: string; status: string }>(api.post('/teacher/apply', values));
      setDone(
        res && res.id
          ? 'Thank you. Your teachership application has been received. Our team will contact you within 72 hours.'
          : 'Application received.',
      );
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
      <h1 className="text-3xl font-extrabold">Become a Certified Teacher</h1>
      <p className="mt-2 text-slate-600">Join the Sujyoti Language School and SpeakEdge teaching network.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="card mt-6 space-y-4">
        <div>
          <label className="label">Full name</label>
          <input className="input" {...register('name', { required: true })} />
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
          <label className="label">Email</label>
          <input className="input" type="email" {...register('email', { required: true })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">City</label>
            <input className="input" {...register('city', { required: true })} />
          </div>
          <div>
            <label className="label">CEFR level</label>
            <select className="input" {...register('cefr_level', { required: true })}>
              {CEFR.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Highest qualification</label>
          <input className="input" {...register('qualification', { required: true })} />
        </div>
        <div>
          <label className="label">Teaching experience (optional)</label>
          <textarea
            className="input"
            rows={3}
            placeholder="e.g. 3 years teaching spoken English to school students…"
            {...register('experience')}
          />
        </div>
        <div>
          <label className="label">About you (optional)</label>
          <textarea className="input" rows={3} {...register('bio')} />
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-700">Create your dashboard login</p>
          <p className="mt-1 text-xs text-slate-500">
            You&apos;ll use these to sign in once our team certifies you.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Username</label>
              <input
                className="input"
                autoComplete="username"
                {...register('username', { required: true, minLength: 3 })}
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                {...register('password', { required: true, minLength: 6 })}
              />
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={formState.isSubmitting}>
          Submit application
        </button>
      </form>
    </div>
  );
}
