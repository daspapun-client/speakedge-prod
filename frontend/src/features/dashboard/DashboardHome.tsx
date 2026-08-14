import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  Bell, BadgeCheck, CalendarCheck, CreditCard, User, Video, Users, GraduationCap,
  Award, Gift, Settings, CalendarClock, UserPlus, ArrowRight, Layers, ChevronRight,
  Sparkles, type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { StatusBadge, badgeClass, fmtDay } from '@/features/admin/_shared';
import { StudentEnrolledBatchCard } from '@/features/batch/shared';

interface Dashboard {
  student_id: string;
  full_name: string;
  photo_url?: string | null;
  membership_status: string;
  cefr_status: string;
  cefr_level?: string | null;
  subscription?: { plan: string; expires_at: string } | null;
  unread_notifications: number;
}

interface Membership {
  student_id: string;
  membership_status: string;
  activation_date: string;
  verified_at?: string | null;
  cefr_status: string;
  cefr_level?: string | null;
  reject_reason?: string | null;
}

const BENEFITS = [
  'Lifetime Student ID & membership',
  'Access to the Speaking Community',
  'Complimentary CEFR & Speaking tests',
  'Learning videos',
  'Exclusive member offers',
];

function StatTile({
  label,
  icon: Icon,
  children,
  hint,
  to,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
  hint?: string;
  to?: string;
}) {
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-2">{children}</div>
        {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
      </div>
      <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
        <Icon size={20} />
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="card block transition hover:border-brand hover:shadow-md">
        {inner}
      </Link>
    );
  }
  return <div className="card">{inner}</div>;
}

function OverviewRow({
  icon: Icon,
  label,
  value,
  sub,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: string;
  to?: string;
}) {
  const row = (
    <>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <div className="mt-0.5">{value}</div>
        {sub && <p className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</p>}
      </div>
      {to && <ChevronRight size={15} className="shrink-0 text-slate-300" aria-hidden />}
    </>
  );

  const cls = 'flex items-center gap-2.5 px-3 py-2 transition active:bg-slate-50';
  if (to) {
    return (
      <Link to={to} className={cls}>
        {row}
      </Link>
    );
  }
  return <div className={cls}>{row}</div>;
}

function MobileOverview({
  membershipStatus,
  cefrLabel,
  membershipHint,
  subscription,
  unread,
}: {
  membershipStatus: string;
  cefrLabel: string;
  membershipHint?: string;
  subscription?: { plan: string; expires_at: string } | null;
  unread: number;
}) {
  const membershipSub = [cefrLabel, membershipHint].filter(Boolean).join(' · ');

  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:hidden">
      <OverviewRow
        icon={BadgeCheck}
        label="Membership"
        value={<StatusBadge status={membershipStatus} />}
        sub={membershipSub}
      />
      {subscription ? (
        <OverviewRow
          icon={CreditCard}
          label="Subscription"
          value={<span className="text-sm font-bold text-slate-900">{subscription.plan}</span>}
          sub={`Expires ${fmtDay(subscription.expires_at)}`}
          to="/dashboard/subscription"
        />
      ) : (
        <OverviewRow
          icon={CreditCard}
          label="Subscription"
          value={<span className="text-sm font-medium text-slate-500">No active plan</span>}
          sub="View available plans"
          to="/plans"
        />
      )}
      <OverviewRow
        icon={Bell}
        label="Notifications"
        value={
          unread > 0 ? (
            <span className="text-sm font-bold text-brand">{unread} unread</span>
          ) : (
            <span className="text-sm font-medium text-slate-500">All caught up</span>
          )
        }
        to="/dashboard/notifications"
      />
    </div>
  );
}

function MetaChip({ children, to }: { children: ReactNode; to?: string }) {
  const cls =
    'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-sm';
  if (to) {
    return (
      <Link to={to} className={`${cls} transition active:scale-95 hover:border-brand/30 hover:text-brand`}>
        {children}
      </Link>
    );
  }
  return <span className={cls}>{children}</span>;
}

function ResubmitForm() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ full_name: '', phone: '', whatsapp: '', email: '', address: '', about_me: '', cefr_level: '' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {};
      Object.entries(form).forEach(([k, v]) => { if (v.trim()) body[k] = v.trim(); });
      return unwrap(api.post('/membership/resubmit', body));
    },
    onSuccess: () => { setError(''); setDone(true); qc.invalidateQueries({ queryKey: ['membership'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e: Error) => setError(e.message),
  });

  if (done)
    return (
      <div className="card border-green-200 bg-green-50">
        <p className="font-semibold text-green-700">Resubmitted for verification</p>
        <p className="mt-1 text-sm text-green-600">Your details are back in the verification queue.</p>
      </div>
    );

  return (
    <div className="card border-red-200">
      <h2 className="font-bold text-red-700">Correct &amp; resubmit</h2>
      <p className="mt-1 text-sm text-slate-500">Update the fields that need correcting and resubmit for verification. Leave a field blank to keep it unchanged.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Full name</label><input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        <div><label className="label">WhatsApp</label><input className="input" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></div>
        <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">About me</label><textarea className="input" rows={2} value={form.about_me} onChange={(e) => set('about_me', e.target.value)} /></div>
        <div><label className="label">CEFR level</label><input className="input" value={form.cefr_level} onChange={(e) => set('cefr_level', e.target.value)} /></div>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button className="btn-primary mt-4 w-full sm:w-auto" disabled={submit.isPending} onClick={() => submit.mutate()}>Resubmit</button>
    </div>
  );
}

interface Booking {
  id: string;
  exam_id: string;
  status: string;
  created_at: string;
}

interface JoinRequest {
  id: string;
  requester_name: string;
  team_name: string;
}

interface EnrolledBatch {
  id: string;
  title: string;
  teacher_name?: string | null;
  day_of_week?: string | null;
  class_time?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  schedule?: string | null;
  status: 'member' | 'pending' | 'none';
  meeting_active: boolean;
  meeting_url?: string | null;
  member_count?: number;
}

const QUICK_LINKS: { to: string; label: string; icon: LucideIcon; needsSub?: boolean }[] = [
  { to: '/dashboard/profile', label: 'Profile', icon: User },
  { to: '/dashboard/learning', label: 'Learning', icon: Sparkles },
  { to: '/dashboard/subscription', label: 'Subscription', icon: CreditCard },
  { to: '/dashboard/videos', label: 'Videos', icon: Video },
  { to: '/dashboard/attendance', label: 'Attendance', icon: CalendarCheck },
  { to: '/dashboard/community', label: 'Community Class', icon: Users },
  { to: '/dashboard/exams', label: 'Exams', icon: GraduationCap, needsSub: true },
  { to: '/dashboard/reports', label: 'Reports', icon: Award },
  { to: '/dashboard/payments', label: 'Payments', icon: CreditCard },
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { to: '/dashboard/offers', label: 'Offers', icon: Gift },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
];

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-4 sm:space-y-6">
      <div className="h-44 rounded-2xl bg-slate-200 sm:h-36 sm:rounded-xl" />
      <div className="overflow-hidden rounded-xl border border-slate-200 sm:hidden">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 last:border-0">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-slate-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2 w-16 rounded bg-slate-200" />
              <div className="h-3 w-24 rounded bg-slate-200" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden gap-4 sm:grid sm:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-xl bg-slate-200" />)}
      </div>
      <div className="h-48 rounded-xl bg-slate-200" />
    </div>
  );
}

export function DashboardHome() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => unwrap<Dashboard>(api.get('/dashboard/')),
  });
  const { data: membership } = useQuery({
    queryKey: ['membership'],
    queryFn: () => unwrap<Membership>(api.get('/dashboard/membership')),
  });
  const { data: bookings } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => unwrap<Booking[]>(api.get('/exams/my-bookings')),
  });
  const { data: joinReqs } = useQuery({
    queryKey: ['join-requests'],
    queryFn: () => unwrap<JoinRequest[]>(api.get('/community/teams/join-requests')),
    refetchInterval: 30000,
  });
  const { data: batchData } = useQuery({
    queryKey: ['browse-batches'],
    queryFn: () => unwrap<{ batches: EnrolledBatch[] }>(api.get('/teacher/browse-batches')),
    enabled: data?.membership_status === 'Active' && !!data?.subscription,
  });
  const { data: attendance } = useQuery({
    queryKey: ['my-attendance'],
    queryFn: () => unwrap<{ pending_count: number; deadline_hours: number }>(
      api.get('/dashboard/attendance'),
    ),
  });
  const { data: orientation } = useQuery({
    queryKey: ['orientation-status'],
    queryFn: () => unwrap<{ status: string }>(api.get('/orientation/me')),
    enabled: data?.membership_status === 'Active',
  });
  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'decline' }) =>
      unwrap(api.post(`/community/teams/join-requests/${id}/${action}`, {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['join-requests'] }),
  });

  if (isLoading) return <DashboardSkeleton />;
  if (!data) return null;

  const upcoming = (bookings ?? []).filter((b) => b.status === 'booked');
  const notApproved = data.membership_status !== 'Active';
  const examsDisabled = notApproved || !data.subscription;
  const examsDisabledReason = notApproved
    ? 'Available once your membership is approved'
    : 'Requires an active subscription';
  const cefrLabel = data.cefr_level ? `${data.cefr_status} (${data.cefr_level})` : data.cefr_status;
  const membershipHint = membership
    ? membership.verified_at
      ? `Verified ${fmtDay(membership.verified_at)}`
      : `Activated ${fmtDay(membership.activation_date)} · verification pending`
    : undefined;
  const enrolledBatches = (batchData?.batches ?? []).filter((b) => b.status === 'member');
  const firstName = data.full_name.split(/\s+/)[0] ?? data.full_name;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Welcome hero — full-bleed on mobile */}
      <div className="-mx-3 overflow-hidden rounded-none border-0 bg-white shadow-none sm:mx-0 sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="relative bg-gradient-to-br from-brand via-brand to-brand-light px-4 pb-5 pt-5 text-white sm:px-8 sm:py-6">
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl"
            aria-hidden
          />
          <div className="relative flex items-start gap-3.5 sm:gap-5">
            {data.photo_url ? (
              <img
                src={data.photo_url}
                alt=""
                className="h-14 w-14 shrink-0 rounded-2xl border-2 border-white/30 object-cover shadow-lg sm:h-20 sm:w-20 sm:rounded-full sm:border-4"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-white/30 bg-white/20 text-xl font-bold shadow-lg sm:h-20 sm:w-20 sm:rounded-full sm:border-4 sm:text-2xl">
                {data.full_name?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-xs font-medium text-white/75 sm:text-sm sm:text-white/80">Student dashboard</p>
              <h1 className="mt-0.5 text-xl font-extrabold leading-tight sm:text-3xl">
                Hi, {firstName}
              </h1>
              <p className="mt-1 truncate font-mono text-[11px] text-white/65 sm:text-sm sm:text-white/70">{data.student_id}</p>
              <div className="mt-2.5 sm:hidden">
                <StatusBadge status={data.membership_status} />
              </div>
            </div>
            <div className="hidden shrink-0 sm:block">
              <StatusBadge status={data.membership_status} />
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 bg-slate-50/80 px-3 py-3 sm:px-8 sm:py-4">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <MetaChip>
              <GraduationCap size={13} className="text-brand" />
              {cefrLabel}
            </MetaChip>
            {data.subscription ? (
              <MetaChip>
                <CreditCard size={13} className="text-brand" />
                {data.subscription.plan} · {fmtDay(data.subscription.expires_at)}
              </MetaChip>
            ) : (
              <MetaChip to="/plans">
                <CreditCard size={13} className="text-brand" />
                No plan · View plans
              </MetaChip>
            )}
            {data.unread_notifications > 0 && (
              <MetaChip to="/dashboard/notifications">
                <Bell size={13} className="text-brand" />
                {data.unread_notifications} unread
              </MetaChip>
            )}
          </div>
        </div>
      </div>

      {!notApproved && orientation && orientation.status !== 'completed' && (
        <Link
          to="/dashboard/orientation"
          className="card block border-brand/30 bg-gradient-to-r from-brand/10 to-brand/5 p-4 transition hover:border-brand hover:shadow-md sm:p-5"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
              <GraduationCap size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-900">
                {orientation.status === 'in_progress' ? 'Continue your orientation' : 'Start your orientation'}
              </p>
              <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
                A quick tour of SpeakEdge to kick off your learning journey.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">
              {orientation.status === 'in_progress' ? 'Resume' : 'Start'} <ArrowRight size={14} />
            </span>
          </div>
        </Link>
      )}

      {!notApproved && !!attendance?.pending_count && (
        <Link
          to="/dashboard/attendance"
          className="card block border-amber-300 bg-amber-50 p-4 transition hover:border-amber-400 hover:shadow-md sm:p-5"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
              <CalendarCheck size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-900">
                Confirm your attendance
                {attendance.pending_count > 1 ? ` (${attendance.pending_count} classes)` : ''}
              </p>
              <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
                Respond within {attendance.deadline_hours} hours of the reminder or your seat is released automatically.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white">
              Respond <ArrowRight size={14} />
            </span>
          </div>
        </Link>
      )}

      {!!joinReqs?.length && (
        <div className="card border-brand/30 bg-brand/5 p-4 sm:p-5">
          <div className="flex items-center gap-2 font-bold text-brand">
            <UserPlus size={18} /> Community class join requests
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {joinReqs.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 py-3 text-sm first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <span className="leading-snug">
                  <span className="font-semibold text-slate-800">{r.requester_name}</span>
                  <span className="text-slate-500"> wants to join </span>
                  <span className="font-semibold text-slate-800">{r.team_name}</span>
                </span>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                  <button className="btn-primary py-2 text-xs sm:py-1.5" disabled={respond.isPending} onClick={() => respond.mutate({ id: r.id, action: 'approve' })}>Approve</button>
                  <button className="btn-ghost py-2 text-xs sm:py-1.5" disabled={respond.isPending} onClick={() => respond.mutate({ id: r.id, action: 'decline' })}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Key stats */}
      <section>
        <h2 className="mb-2 hidden text-base font-bold text-slate-800 sm:mb-3 sm:block">Overview</h2>

        <MobileOverview
          membershipStatus={data.membership_status}
          cefrLabel={cefrLabel}
          membershipHint={membershipHint}
          subscription={data.subscription}
          unread={data.unread_notifications}
        />

        <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label="Membership" icon={BadgeCheck} hint={membershipHint}>
            <StatusBadge status={data.membership_status} />
            <p className="mt-2 text-sm leading-snug text-slate-600">{cefrLabel}</p>
          </StatTile>

          <StatTile label="Subscription" icon={CreditCard}>
            {data.subscription ? (
              <>
                <p className="text-xl font-extrabold text-brand">{data.subscription.plan}</p>
                <p className="mt-1 text-sm text-slate-500">Expires {fmtDay(data.subscription.expires_at)}</p>
              </>
            ) : (
              <div>
                <p className="text-sm text-slate-500">No active plan</p>
                <Link to="/plans" className="btn-gold mt-3 inline-flex py-1.5 text-xs">View plans</Link>
              </div>
            )}
          </StatTile>

          <StatTile label="Notifications" icon={Bell} to="/dashboard/notifications" hint="Tap to view all">
            <p className="text-3xl font-extrabold text-brand">{data.unread_notifications}</p>
            <p className="text-sm text-slate-500">unread</p>
          </StatTile>
        </div>
      </section>

      {/* Quick access — primary mobile actions */}
      <section className="card p-4 sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 sm:text-lg">Quick access</h2>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">Jump to your most-used sections</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-5 sm:gap-3">
          {QUICK_LINKS.map((q) => {
            const disabled = notApproved || (q.needsSub && !data.subscription);
            const reason = notApproved
              ? 'Available once your membership is approved'
              : 'Requires an active subscription';

            if (disabled) {
              return (
                <div
                  key={q.to}
                  aria-disabled
                  title={reason}
                  className="flex cursor-not-allowed flex-col items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50/80 py-3 text-center sm:gap-2.5 sm:py-5"
                >
                  <div className="rounded-xl bg-slate-100 p-2.5 text-slate-300 sm:p-3">
                    <q.icon size={20} className="sm:hidden" />
                    <q.icon size={22} className="hidden sm:block" />
                  </div>
                  <span className="text-[10px] font-medium leading-tight text-slate-300 sm:text-sm">{q.label}</span>
                </div>
              );
            }

            return (
              <Link
                key={q.to}
                to={q.to}
                className="group flex flex-col items-center gap-1.5 rounded-xl border border-slate-100 bg-white py-3 text-center transition active:scale-95 hover:border-brand/30 hover:shadow-sm sm:gap-2.5 sm:py-5"
              >
                <div className="rounded-xl bg-brand/10 p-2.5 text-brand transition group-hover:bg-brand group-hover:text-white sm:p-3">
                  <q.icon size={20} className="sm:hidden" />
                  <q.icon size={22} className="hidden sm:block" />
                </div>
                <span className="text-[10px] font-medium leading-tight text-slate-700 group-hover:text-brand sm:text-sm">{q.label}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {enrolledBatches.length > 0 && (
        <section className="space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-800 sm:text-lg">
                <Layers size={18} className="text-brand" /> Your batches
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">Class schedule, teacher and meet link</p>
            </div>
            <Link to="/dashboard/batches" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand transition active:scale-95 hover:bg-brand/5 sm:text-sm">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="space-y-4 sm:space-y-6">
            {enrolledBatches.map((b) => (
              <StudentEnrolledBatchCard key={b.id} batch={b} />
            ))}
          </div>
        </section>
      )}

      {data.membership_status === 'Rejected' && (
        <>
          {membership?.reject_reason && (
            <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700 sm:p-5">
              <span className="font-semibold">Reason for rejection:</span> {membership.reject_reason}
            </div>
          )}
          <ResubmitForm />
        </>
      )}

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="space-y-4 sm:space-y-6 lg:col-span-2">
          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <CalendarClock size={18} className="text-brand" /> Upcoming exams
              </div>
              {examsDisabled ? (
                <span
                  aria-disabled
                  title={examsDisabledReason}
                  className="inline-flex cursor-not-allowed items-center gap-1 text-xs font-medium text-slate-300 sm:text-sm"
                >
                  View all <ArrowRight size={14} />
                </span>
              ) : (
                <Link to="/dashboard/exams" className="inline-flex items-center gap-1 text-xs font-semibold text-brand transition active:scale-95 sm:text-sm">
                  View all <ArrowRight size={14} />
                </Link>
              )}
            </div>
            {upcoming.length ? (
              <ul className="mt-3 divide-y divide-slate-100 sm:mt-4">
                {upcoming.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="truncate font-mono text-xs text-slate-700 sm:text-sm">{b.exam_id}</span>
                    <span className={`badge shrink-0 ${badgeClass(b.status)}`}>{b.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-5 flex flex-col items-center py-3 text-center sm:mt-6 sm:py-4">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-400">
                  <GraduationCap size={24} className="sm:hidden" />
                  <GraduationCap size={28} className="hidden sm:block" />
                </div>
                <p className="mt-3 text-sm text-slate-500">No upcoming exams scheduled.</p>
                {examsDisabled ? (
                  <span
                    aria-disabled
                    title={examsDisabledReason}
                    className="btn-ghost mt-3 inline-block cursor-not-allowed py-1.5 text-sm text-slate-300"
                  >
                    Book an exam
                  </span>
                ) : (
                  <Link to="/dashboard/exams" className="btn-ghost mt-3 py-1.5 text-sm">Book an exam</Link>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card h-fit p-4 sm:p-5">
          <h2 className="font-bold text-slate-900">Membership benefits</h2>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">Included with your SpeakEdge membership</p>
          <ul className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3">
            {BENEFITS.map((b) => (
              <li key={b} className="flex gap-2.5 text-sm text-slate-600 sm:gap-3">
                <span className="mt-0.5 shrink-0 rounded-full bg-brand/10 p-1 text-brand">
                  <BadgeCheck size={14} />
                </span>
                <span className="leading-snug">{b}</span>
              </li>
            ))}
          </ul>
          <Link
            to="/dashboard/subscription"
            className="mt-4 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3 text-sm font-semibold text-brand transition active:scale-[0.99] hover:border-brand/20 hover:bg-brand/5 sm:hidden"
          >
            Manage subscription
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
