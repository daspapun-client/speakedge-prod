import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import {
  User, Mail, Phone, MapPin, Camera, Loader2, CheckCircle2, AlertCircle,
  Settings, IdCard, MessageSquare, ArrowRight, GraduationCap, type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';
import { InstructionsPanel } from '@/features/dashboard/InstructionsPanel';

interface Profile {
  full_name: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  state?: string;
  district?: string;
  pin_code?: string;
  about_me?: string;
  photo_url?: string | null;
  student_id: string;
  // Learning preferences — feed the AI prompt engine and instruction language.
  cefr_level?: string | null;
  preferred_english?: string;
  preferred_language?: string;
  audience?: string;
}

const ENGLISH_STYLES = ['British English', 'American English', 'Neutral International English'];

function StatTile({ label, value, icon: Icon, hint }: { label: string; value: string | number; icon: LucideIcon; hint?: string }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 truncate text-xl font-extrabold text-brand">{value}</div>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-48 rounded bg-slate-200" />
      <div className="h-32 rounded-xl bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-slate-200" />)}
      </div>
      <div className="h-96 rounded-xl bg-slate-200" />
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

function profileCompleteness(p: Profile | undefined) {
  if (!p) return 0;
  const fields = [p.full_name, p.phone, p.whatsapp, p.address, p.state, p.district, p.pin_code, p.about_me, p.photo_url];
  return Math.round((fields.filter((f) => f && String(f).trim()).length / fields.length) * 100);
}

export function ProfilePage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => unwrap<Profile>(api.get('/dashboard/profile')),
  });
  const languages = useQuery({
    queryKey: ['instruction-languages'],
    queryFn: () => unwrap<{ languages: { code: string; label: string; native: string }[] }>(
      api.get('/instructions/languages'),
    ),
  });
  const { register, handleSubmit, reset } = useForm<Profile>();

  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const save = useMutation({
    mutationFn: (v: Partial<Profile>) => unwrap(api.put('/dashboard/profile', v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('photo', file);
      return unwrap(api.post('/dashboard/profile/photo', fd));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const completeness = useMemo(() => profileCompleteness(data), [data]);
  const locationLabel = [data?.district, data?.state].filter(Boolean).join(', ') || 'Not set';

  if (isLoading) return <ProfileSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Manage your personal details, photo, and contact information"
        actions={
          <Link to="/dashboard/settings" className="btn-ghost inline-flex items-center gap-2">
            <Settings size={16} /> Settings
          </Link>
        }
      />

      <div className="card overflow-hidden p-0">
        <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-6 text-white sm:px-8">
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative">
              {data?.photo_url ? (
                <img
                  src={data.photo_url}
                  alt=""
                  className="h-20 w-20 rounded-full object-cover ring-4 ring-white/30"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/20 text-2xl font-bold ring-4 ring-white/30">
                  {data?.full_name?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <button
                type="button"
                className="absolute -bottom-1 -right-1 rounded-full bg-white p-1.5 text-brand shadow-md transition hover:bg-slate-50"
                disabled={uploadPhoto.isPending}
                onClick={() => fileRef.current?.click()}
                aria-label="Change photo"
              >
                {uploadPhoto.isPending ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadPhoto.mutate(e.target.files[0])}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white/80">SpeakEdge member</p>
              <h2 className="truncate text-2xl font-extrabold">{data?.full_name ?? '—'}</h2>
              <p className="mt-1 font-mono text-sm text-white/70">{data?.student_id}</p>
            </div>
            <button
              type="button"
              className="btn-ghost shrink-0 border-white/30 bg-white/10 text-white hover:bg-white/20"
              disabled={uploadPhoto.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {uploadPhoto.isPending ? 'Uploading…' : 'Change photo'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Profile complete" value={`${completeness}%`} icon={User} hint={completeness >= 80 ? 'Looking good' : 'Add more details'} />
        <StatTile label="Student ID" value={data?.student_id ?? '—'} icon={IdCard} hint="Your unique member ID" />
        <StatTile label="Location" value={locationLabel} icon={MapPin} hint={data?.pin_code ? `PIN ${data.pin_code}` : 'State & district'} />
      </div>

      {(save.isSuccess || save.isError || uploadPhoto.isError) && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
          save.isError || uploadPhoto.isError
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          {save.isError || uploadPhoto.isError ? (
            <>
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              {(save.error as Error)?.message || (uploadPhoto.error as Error)?.message}
            </>
          ) : (
            <>
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
              Profile saved successfully
            </>
          )}
        </div>
      )}

      <form
        onSubmit={handleSubmit((v) =>
          save.mutate({
            full_name: v.full_name,
            phone: v.phone,
            whatsapp: v.whatsapp,
            address: v.address,
            state: v.state,
            district: v.district,
            pin_code: v.pin_code,
            about_me: v.about_me,
            preferred_english: v.preferred_english,
            preferred_language: v.preferred_language,
          }),
        )}
        className="space-y-6"
      >
        <Section title="Personal details" icon={User} description="Name and account email">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Full name</label>
              <input className="input" {...register('full_name')} />
            </div>
            <div>
              <label className="label inline-flex items-center gap-1">
                <Mail size={14} className="text-slate-400" /> Email <span className="text-slate-400">(read-only)</span>
              </label>
              <input className="input cursor-not-allowed bg-slate-50 text-slate-500" {...register('email')} readOnly />
            </div>
          </div>
        </Section>

        <Section title="Contact" icon={Phone} description="How we reach you for classes and updates">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label inline-flex items-center gap-1">
                <Phone size={14} className="text-slate-400" /> Mobile
              </label>
              <input className="input" type="tel" placeholder="+91 …" {...register('phone')} />
            </div>
            <div>
              <label className="label inline-flex items-center gap-1">
                <MessageSquare size={14} className="text-slate-400" /> WhatsApp
              </label>
              <input className="input" type="tel" placeholder="+91 …" {...register('whatsapp')} />
            </div>
          </div>
        </Section>

        <Section title="Address" icon={MapPin} description="Used for certificates and correspondence">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="label">Street address</label>
              <input className="input" placeholder="House no., street, locality" {...register('address')} />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" {...register('state')} />
            </div>
            <div>
              <label className="label">District</label>
              <input className="input" {...register('district')} />
            </div>
            <div>
              <label className="label">PIN code</label>
              <input className="input" inputMode="numeric" {...register('pin_code')} />
            </div>
          </div>
        </Section>

        <Section
          title="Learning preferences"
          icon={GraduationCap}
          description="These drive your AI practice sessions automatically — you never edit a prompt yourself."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="label">CEFR level <span className="text-slate-400">(read-only)</span></label>
              <input
                className="input cursor-not-allowed bg-slate-50 text-slate-500"
                value={data?.cefr_level || 'Not assessed yet'}
                readOnly
              />
              <p className="mt-1 text-xs text-slate-400">Set by your CEFR assessment.</p>
            </div>
            <div>
              <label className="label">Preferred English</label>
              <select className="input" {...register('preferred_english')}>
                {ENGLISH_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="mt-1 text-xs text-slate-400">Accent and idiom your tutor uses.</p>
            </div>
            <div>
              <label className="label">Language for instructions</label>
              <select className="input" {...register('preferred_language')}>
                {(languages.data?.languages ?? [{ code: 'en', label: 'English', native: 'English' }]).map((l) => (
                  <option key={l.code} value={l.code}>{l.native} · {l.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">Instructions and correction explanations.</p>
            </div>
          </div>
        </Section>

        <Section title="About you" icon={MessageSquare} description="A short bio visible to classmates in batches">
          <div>
            <label className="label">About me</label>
            <textarea className="input min-h-[100px] resize-y" rows={4} placeholder="Tell classmates a little about yourself…" {...register('about_me')} />
          </div>
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            Changes sync to your community profile after save.
          </p>
          <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={save.isPending}>
            {save.isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Saving…</>
            ) : (
              <>Save changes <ArrowRight size={16} /></>
            )}
          </button>
        </div>
      </form>

      <InstructionsPanel preferredLanguage={data?.preferred_language} />
    </div>
  );
}
