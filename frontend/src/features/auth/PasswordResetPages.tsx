import { useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { CONTACT_PHONE, WHATSAPP_URL } from '@/lib/site';

/** Shared shell so both steps of the flow read as one screen. */
function AuthCard({ icon: Icon, title, subtitle, children }: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md py-8 sm:py-12">
      <div className="card p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-xl bg-brand/10 p-2.5 text-brand">
            <Icon size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{title}</h1>
            {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
      <p className="mt-5 text-center text-sm text-slate-500">
        <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-brand hover:underline">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </p>
    </div>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Step 1 — WhatsApp support (self-serve email reset is no longer offered here). */
export function ForgotPasswordPage() {
  return (
    <AuthCard icon={KeyRound} title="Forgot your password?">
      <p className="text-sm leading-relaxed text-slate-600">
        WhatsApp{' '}
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-brand hover:underline"
        >
          {CONTACT_PHONE.replace(/ /g, '')}
        </a>{' '}
        with your Student ID / Email / Username to receive support within 48 hours.
      </p>
    </AuthCard>
  );
}

interface ResetForm {
  new_password: string;
  confirm: string;
}

/** Step 2 — the emailed link lands here with ?token=. */
export function ResetPasswordPage() {
  const { register, handleSubmit } = useForm<ResetForm>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  async function onSubmit(v: ResetForm) {
    setError('');
    if (v.new_password !== v.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await unwrap(api.post('/auth/reset-password', { token, new_password: v.new_password }));
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthCard icon={KeyRound} title="Reset link missing" subtitle="This page needs a valid reset link">
        <div className="space-y-4">
          <ErrorNote>That link is incomplete. Contact support with your Student ID, email or username.</ErrorNote>
          <Link to="/forgot-password" className="btn-primary w-full py-2.5">
            Contact support <ArrowRight size={16} />
          </Link>
        </div>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard icon={CheckCircle2} title="Password updated" subtitle="You can sign in with your new password">
        <button type="button" className="btn-primary w-full py-2.5" onClick={() => navigate('/login')}>
          Go to sign in <ArrowRight size={16} />
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard icon={Lock} title="Choose a new password" subtitle="At least 8 characters">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="label" htmlFor="new_password">New password</label>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="new_password"
              className="input bg-slate-50 pl-10 pr-10 focus:bg-white"
              type={show ? 'text' : 'password'}
              placeholder="Enter a new password"
              autoComplete="new-password"
              autoFocus
              {...register('new_password', { required: true, minLength: 8 })}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="confirm">Confirm new password</label>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="confirm"
              className="input bg-slate-50 pl-10 focus:bg-white"
              type={show ? 'text' : 'password'}
              placeholder="Repeat the new password"
              autoComplete="new-password"
              {...register('confirm', { required: true })}
            />
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
          {loading ? (
            <><Loader2 size={16} className="animate-spin" /> Saving…</>
          ) : (
            <>Set new password <ArrowRight size={16} /></>
          )}
        </button>
      </form>
    </AuthCard>
  );
}
