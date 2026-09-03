import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import {
  Settings, Lock, Shield, Bell, User, Loader2, CheckCircle2, AlertCircle,
  ArrowRight, Sparkles, type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth';
import {
  pushPermission, pushSupported, subscribePush, unsubscribePush,
} from '@/lib/pushNotifications';
import { PageHeader } from '@/features/admin/_shared';

interface PwForm {
  old_password: string;
  new_password: string;
  confirm: string;
}

function StatTile({ label, value, icon: Icon, hint }: { label: string; value: string; icon: LucideIcon; hint?: string }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 text-xl font-extrabold text-brand">{value}</div>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: LucideIcon;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="border-b border-slate-100 pb-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-brand/10 p-2 text-brand">
            <Icon size={18} />
          </span>
          <div>
            <h2 className="font-bold text-slate-800">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const [mismatch, setMismatch] = useState(false);
  const [pushState, setPushState] = useState<'loading' | 'unsupported' | NotificationPermission>('loading');
  const { register, handleSubmit, reset, formState } = useForm<PwForm>();

  useEffect(() => {
    void (async () => {
      setPushState(await pushPermission());
    })();
  }, []);

  const pushToggle = useMutation({
    mutationFn: async (enable: boolean) => {
      if (enable) {
        const res = await subscribePush();
        if (!res.ok) throw new Error(res.reason);
      } else {
        await unsubscribePush();
      }
    },
    onSuccess: async () => setPushState(await pushPermission()),
  });

  const change = useMutation({
    mutationFn: (v: { old_password: string; new_password: string }) => unwrap(api.post('/auth/change-password', v)),
    onSuccess: () => {
      reset();
      setMismatch(false);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Account security and preferences for your SpeakEdge account"
        actions={
          <Link to="/dashboard/profile" className="btn-ghost inline-flex items-center gap-2">
            <User size={16} /> Profile
          </Link>
        }
      />

      <div className="card overflow-hidden p-0">
        <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-5 text-white sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90">
                <Sparkles size={14} /> Account security
              </p>
              <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">Keep your account secure</h2>
              <p className="mt-1 text-sm text-white/80">Use a strong password and update it periodically</p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <Shield size={28} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Password" value="Protected" icon={Lock} hint="Change below anytime" />
        <StatTile label="Security" value="Active" icon={Shield} hint="Login credentials" />
        <StatTile label="Preferences" value={pushState === 'granted' ? 'Push on' : 'Push off'} icon={Bell} hint="Browser notifications" />
      </div>

      <Section title="Change password" icon={Lock} description="Enter your current password, then choose a new one">
        <form
          className="space-y-4"
          onSubmit={handleSubmit((v) => {
            if (v.new_password !== v.confirm) {
              setMismatch(true);
              return;
            }
            setMismatch(false);
            change.mutate({ old_password: v.old_password, new_password: v.new_password });
          })}
        >
          <div className="grid gap-4 md:grid-cols-1 max-w-xl">
            <div>
              <label className="label">Current password</label>
              <input type="password" className="input" autoComplete="current-password" {...register('old_password', { required: true })} />
            </div>
            <div>
              <label className="label">New password</label>
              <input
                type="password"
                className="input"
                autoComplete="new-password"
                placeholder={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
                {...register('new_password', { required: true, minLength: MIN_PASSWORD_LENGTH })}
              />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input type="password" className="input" autoComplete="new-password" {...register('confirm', { required: true })} />
            </div>
          </div>

          {(formState.errors.new_password || mismatch || change.isError || change.isSuccess) && (
            <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
              change.isSuccess
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}>
              {change.isSuccess ? (
                <>
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                  Password updated successfully
                </>
              ) : (
                <>
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  {mismatch
                    ? 'New password and confirmation do not match'
                    : formState.errors.new_password
                      ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
                      : (change.error as Error).message}
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-sm text-slate-500">You will stay logged in after updating your password.</p>
            <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={change.isPending}>
              {change.isPending ? (
                <><Loader2 size={16} className="animate-spin" /> Updating…</>
              ) : (
                <>Update password <ArrowRight size={16} /></>
              )}
            </button>
          </div>
        </form>
      </Section>

      <Section title="Push notifications" icon={Bell} description="Get browser alerts for community class messages and other updates">
        {pushState === 'loading' ? (
          <p className="text-sm text-slate-500">Checking browser support…</p>
        ) : pushState === 'unsupported' ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
            Push notifications are not supported in this browser. In-app notifications under{' '}
            <Link to="/dashboard/notifications" className="font-medium text-brand hover:underline">Notifications</Link>{' '}
            still work.
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-4">
            <div>
              <p className="font-semibold text-slate-800">
                {pushState === 'granted' ? 'Enabled' : pushState === 'denied' ? 'Blocked by browser' : 'Not enabled'}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                {pushState === 'granted'
                  ? 'You will receive alerts when someone messages your community class while you are away.'
                  : pushState === 'denied'
                    ? 'Allow notifications in your browser site settings, then try again.'
                    : 'Enable to receive community class chat alerts on this device.'}
              </p>
            </div>
            {pushState === 'granted' ? (
              <button
                type="button"
                className="btn-ghost text-red-600"
                disabled={pushToggle.isPending}
                onClick={() => pushToggle.mutate(false)}
              >
                {pushToggle.isPending ? 'Updating…' : 'Turn off'}
              </button>
            ) : pushState !== 'denied' ? (
              <button
                type="button"
                className="btn-primary"
                disabled={pushToggle.isPending}
                onClick={() => pushToggle.mutate(true)}
              >
                {pushToggle.isPending ? 'Enabling…' : 'Enable push'}
              </button>
            ) : null}
          </div>
        )}
        {pushToggle.isError && (
          <p className="mt-3 text-sm text-red-600">{(pushToggle.error as Error).message}</p>
        )}
      </Section>

      <Section title="More preferences" icon={Settings} description="Additional controls coming soon">
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-6 text-center text-sm text-slate-500">
          Email and per-category notification preferences will be added in a future update.
        </div>
      </Section>
    </div>
  );
}
