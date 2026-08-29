import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, ArrowRight, BookOpen, Check, Eye, EyeOff, Loader2, Lock, LogIn, Sparkles, User,
} from 'lucide-react';
import { homeFor, useAuth } from '@/lib/auth';
import { Logo } from '@/components/Logo';

interface LoginForm {
  username: string;
  password: string;
}

const PERKS = [
  'AI-guided speaking practice',
  'Live batches & CEFR certification',
  'Speaking Community Access',
];

export function LoginPage() {
  const { register, handleSubmit } = useForm<LoginForm>();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(v: LoginForm) {
    setError('');
    setLoading(true);
    try {
      await login(v.username, v.password);
      const role = useAuth.getState().role;
      const next = searchParams.get('next');
      const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(role);
      navigate(dest);
    } catch {
      setError('Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl py-4 sm:py-8">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid lg:grid-cols-5">
        {/* Brand panel */}
        <div className="relative overflow-hidden bg-gradient-to-br from-brand via-brand to-brand-light px-6 py-8 text-white sm:px-8 lg:col-span-2 lg:flex lg:flex-col lg:justify-between lg:py-10">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-gold/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />

          <div className="relative space-y-5">
            <Link
              to="/"
              aria-label="SpeakEdge home"
              className="inline-flex items-center gap-2.5 rounded-xl border border-white/20 bg-white/10 px-3 py-2 backdrop-blur-sm transition hover:border-white/30 hover:bg-white/15"
            >
              <Logo size="sm" showWordmark={false} />
              <span className="text-lg font-extrabold tracking-tight">
                Speak<span className="text-brand-gold">Edge</span>
              </span>
            </Link>

            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                <Sparkles size={12} className="text-brand-gold" />
                Member portal
              </span>
              <h1 className="mt-4 text-2xl font-extrabold leading-tight tracking-tight sm:text-[1.75rem]">
                Welcome back
              </h1>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/90 sm:text-[15px]">
                Continue your English journey — AI practice, live batches, and your speaking community await.
              </p>
            </div>
          </div>

          <ul className="relative mt-8 space-y-3 lg:mt-10">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-center gap-3 text-sm font-medium text-white">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-brand shadow-sm">
                  <Check size={14} strokeWidth={2.5} />
                </span>
                {perk}
              </li>
            ))}
          </ul>
        </div>

        {/* Form panel */}
        <div className="flex w-full px-6 py-8 sm:px-10 lg:col-span-3 lg:items-center lg:py-12">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-7">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-brand/10 p-2.5 text-brand">
                  <LogIn size={20} />
                </span>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Sign in</h2>
                  <p className="text-sm text-slate-500">Access your dashboard and learning tools</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="label" htmlFor="username">Student ID / Email</label>
                <div className="relative">
                  <User size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="username"
                    className="input bg-slate-50 pl-10 focus:bg-white"
                    placeholder="SPK-26-XXXXXX or you@email.com"
                    autoComplete="username"
                    {...register('username', { required: true })}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-400">Enter your SpeakEdge Student ID or registered email</p>
              </div>

              <div>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <label className="label mb-0" htmlFor="password">Password</label>
                  <Link to="/forgot-password" className="text-xs font-semibold text-brand hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    className="input bg-slate-50 pl-10 pr-10 focus:bg-white"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    {...register('password', { required: true })}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Signing in…
                  </>
                ) : (
                  <>
                    Sign in <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center" aria-hidden>
                <div className="w-full border-t border-slate-100" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  New member
                </span>
              </div>
            </div>

            <Link
              to="/activate"
              className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 transition hover:border-brand/30 hover:bg-brand/5 hover:shadow-sm"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand transition group-hover:bg-brand group-hover:text-white">
                <BookOpen size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-800">Activate your membership</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                  Enter the activation code from your SpeakEdge book
                </span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
