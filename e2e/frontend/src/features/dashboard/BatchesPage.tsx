import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Award, ArrowRight, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Clock, GraduationCap, Layers, MapPin,
  Radio, Search, Sparkles, Users, Video, type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { Modal, PageHeader, StatusBadge, StudentAvatar, badgeClass } from '@/features/admin/_shared';
import {
  BatchScheduleHighlight,
  batchPeriod,
  batchSessionIso,
  batchTimeLabel,
  scheduleDateParts,
  StudentEnrolledBatchCard,
} from '@/features/batch/shared';
import { todayIsoIST } from '@/lib/datetime';
import { BatchShareButton } from '@/features/batch/BatchShareButton';
import { MemberList, type MemberCard } from './MemberList';

interface Batch {
  id: string;
  title: string;
  teacher_name?: string | null;
  teacher_photo_url?: string | null;
  day_of_week?: string | null;
  date?: string | null;
  class_dates?: string[];
  class_time?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  schedule?: string | null;
  status: 'member' | 'pending' | 'none';
  meeting_active: boolean;
  meeting_url?: string | null;
  member_count?: number;
  attendance_submitted_dates?: string[];
}

interface BrowseBatches {
  batches: Batch[];
  batches_used: number;
  batch_limit: number;
}

interface TeacherProfile {
  name: string;
  photo_url?: string | null;
  cefr_level?: string | null;
  qualification?: string | null;
  city?: string | null;
  bio?: string | null;
  certified?: boolean;
}

interface BatchDetail {
  teacher?: TeacherProfile | null;
  members: MemberCard[];
  member_count: number;
  is_member: boolean;
}

type BatchFilter = 'all' | Batch['status'];

const STATUS_LABEL: Record<Batch['status'], string> = {
  member: 'Enrolled',
  pending: 'Pending',
  none: 'Open',
};

const FILTERS: BatchFilter[] = ['all', 'member', 'pending', 'none'];

function timeLabel(b: Batch) {
  if (b.slot_start && b.slot_end) return `${b.slot_start}–${b.slot_end}`;
  return b.class_time || null;
}

function batchSortDate(b: Batch) {
  return batchSessionIso(b) ?? '9999-99-99';
}

function isBatchBrowsable(b: Batch) {
  return batchPeriod(b) !== 'past';
}

function batchTitleKey(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function countBatchClasses(batches: Batch[]) {
  return new Set(batches.map((b) => batchTitleKey(b.title))).size;
}

function groupBrowsableBatches(batches: Batch[], perGroup = 2) {
  const sorted = [...batches].sort((a, b) => batchSortDate(a).localeCompare(batchSortDate(b)));
  const groups = new Map<string, Batch[]>();
  for (const b of sorted) {
    const key = batchTitleKey(b.title);
    const arr = groups.get(key) ?? [];
    if (arr.length < perGroup) {
      arr.push(b);
      groups.set(key, arr);
    }
  }
  return [...groups.values()]
    .sort((a, b) => batchSortDate(a[0]).localeCompare(batchSortDate(b[0])));
}

function scheduleLabel(b: Batch) {
  if (b.class_dates?.length) {
    const dates = [...b.class_dates].sort();
    const range = dates.length > 1
      ? `${dates[0]} – ${dates[dates.length - 1]} · ${dates.length} classes`
      : dates[0];
    const time = timeLabel(b);
    return time ? `${range} · ${time}` : range;
  }
  return [b.day_of_week, timeLabel(b)].filter(Boolean).join(' · ') || 'Schedule TBD';
}

function batchMatchesSearch(b: Batch, q: string) {
  const haystack = [
    b.title,
    b.teacher_name,
    b.id,
    b.day_of_week,
    b.schedule,
    b.class_time,
    b.slot_start,
    b.slot_end,
    timeLabel(b),
    scheduleLabel(b),
    STATUS_LABEL[b.status],
    b.date,
    ...(b.class_dates ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function Section({
  title,
  icon: Icon,
  description,
  count,
  toolbar,
  children,
}: {
  title: string;
  icon: LucideIcon;
  description?: string;
  count?: number;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="space-y-3 border-b border-slate-100 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-brand/10 p-2 text-brand">
              <Icon size={18} />
            </span>
            <div>
              <h2 className="font-bold text-slate-800">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
            </div>
          </div>
          {count != null && (
            <span className="text-sm text-slate-400">{count} batch{count === 1 ? '' : 'es'}</span>
          )}
        </div>
        {toolbar}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function BatchesSkeleton() {
  return (
    <div className="batches-page -mx-3 animate-pulse sm:-mx-4 md:mx-0">
      <div className="hidden space-y-6 md:block">
        <div className="h-8 w-56 rounded bg-slate-200" />
        <div className="h-24 rounded-xl bg-slate-200" />
        <div className="h-14 rounded-xl bg-slate-200" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-52 rounded-xl bg-slate-200" />)}
        </div>
      </div>
      <div className="md:hidden">
        <div className="h-10 border-b border-slate-100 bg-slate-100" />
        <div className="flex gap-2 border-b border-slate-100 px-3 py-2.5">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-7 w-16 rounded-lg bg-slate-200" />)}
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="mx-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
            <div className="flex gap-3">
              <div className="h-14 w-12 shrink-0 rounded-xl bg-slate-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-16 rounded-full bg-slate-200" />
                <div className="h-4 w-full rounded bg-slate-200" />
                <div className="h-8 w-8 rounded-full bg-slate-100" />
              </div>
            </div>
            <div className="mt-4 h-10 rounded-xl bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition',
        active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 active:bg-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function MobileBatchCardShell({
  children,
  accent = 'open',
}: {
  children: ReactNode;
  accent?: 'live' | 'open' | 'pending' | 'past' | 'enrolled';
}) {
  const borderAccent = {
    live: 'border-l-red-500',
    open: 'border-l-brand',
    pending: 'border-l-amber-400',
    past: 'border-l-slate-300',
    enrolled: 'border-l-emerald-500',
  }[accent];

  return (
    <article
      className={`mx-3 overflow-hidden rounded-2xl border border-slate-200/70 border-l-[3px] bg-white shadow-sm ring-1 ring-slate-900/[0.03] ${borderAccent}`}
    >
      {children}
    </article>
  );
}

function MobileBatchDateBadge({ dateIso }: { dateIso: string }) {
  const date = scheduleDateParts(dateIso);
  if (!date) return null;

  return (
    <div className="flex w-[3.25rem] shrink-0 flex-col overflow-hidden rounded-xl bg-gradient-to-b from-brand to-brand-light text-center text-white shadow-sm">
      <span className="py-0.5 text-[9px] font-bold uppercase tracking-wider">{date.month}</span>
      <span className="text-xl font-bold leading-none">{date.day}</span>
      <span className="pb-1.5 text-[9px] font-semibold uppercase tracking-wide text-white/90">{date.weekdayShort}</span>
    </div>
  );
}

function MobileBrowseBatchRow({
  b,
  atCap,
  joining,
  onJoin,
  withdrawing,
  onWithdraw,
  onDetails,
  past,
  hideTitle,
}: {
  b: Batch;
  atCap: boolean;
  joining: boolean;
  onJoin: (id: string) => void;
  withdrawing: boolean;
  onWithdraw: (id: string) => void;
  onDetails: () => void;
  past?: boolean;
  hideTitle?: boolean;
}) {
  const live = b.status === 'member' && b.meeting_active;
  const dateIso = batchSessionIso(b);
  const time = batchTimeLabel(b) ?? timeLabel(b);
  const memberCount = b.member_count ?? 0;
  const accent = past ? 'past' : live ? 'live' : b.status === 'pending' ? 'pending' : b.status === 'member' ? 'enrolled' : 'open';

  return (
    <MobileBatchCardShell accent={accent}>
      <div className="p-4">
        <div className="flex items-start gap-3.5">
          {dateIso ? (
            <MobileBatchDateBadge dateIso={dateIso} />
          ) : (
            <span className="flex h-[4.5rem] w-[3.25rem] shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
              <CalendarClock size={22} strokeWidth={1.75} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <BatchStatusPill status={b.status} live={live} />
              {time && (
                <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-slate-500">
                  <Clock size={12} className="shrink-0 text-brand/70" />
                  {time}
                </span>
              )}
            </div>
            {!hideTitle && (
              <h3 className="mt-2 line-clamp-2 text-[16px] font-semibold leading-snug tracking-tight text-slate-900">
                {b.title}
              </h3>
            )}
            <div className={`flex items-center gap-2.5 ${hideTitle ? 'mt-1.5' : 'mt-2.5'}`}>
              {b.teacher_name ? (
                <StudentAvatar photoUrl={b.teacher_photo_url} name={b.teacher_name} size="h-9 w-9" iconSize={15} />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand ring-2 ring-white">
                  <GraduationCap size={15} />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{b.teacher_name || 'Teacher to be assigned'}</p>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Instructor</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onDetails}
            className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1 text-left text-xs font-medium text-slate-600 transition active:bg-slate-50"
          >
            <Users size={14} className="shrink-0 text-slate-400" />
            <span className="truncate">{memberCount} {memberCount === 1 ? 'classmate' : 'classmates'}</span>
            <ChevronRight size={14} className="ml-auto shrink-0 text-brand" />
          </button>
        </div>

        <div className="mt-3">
          {past ? (
            <p className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-50 py-2.5 text-xs font-semibold text-slate-500">
              <Clock size={14} /> Session ended
            </p>
          ) : b.status === 'none' ? (
            atCap ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-center text-xs font-medium text-amber-800 ring-1 ring-amber-200/80">
                Plan limit reached — leave a batch to join another
              </p>
            ) : (
              <button
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition active:scale-[0.98] disabled:opacity-60"
                disabled={joining}
                onClick={() => onJoin(b.id)}
              >
                {joining ? 'Requesting…' : 'Request to join'}
                {!joining && <ArrowRight size={16} strokeWidth={2.25} />}
              </button>
            )
          ) : b.status === 'pending' ? (
            <div className="flex gap-2">
              <p className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-200/80 bg-amber-50 py-2.5 text-xs font-semibold text-amber-800">
                <Clock size={14} /> Awaiting approval
              </p>
              <button
                type="button"
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 transition active:bg-slate-50"
                disabled={withdrawing}
                onClick={() => onWithdraw(b.id)}
              >
                {withdrawing ? '…' : 'Withdraw'}
              </button>
            </div>
          ) : b.meeting_url ? (
            <a
              className="btn-gold flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold shadow-sm active:scale-[0.98]"
              href={b.meeting_url}
              target="_blank"
              rel="noreferrer"
            >
              <Video size={16} /> Join live session
            </a>
          ) : (
            <p className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200/80 bg-emerald-50 py-2.5 text-xs font-semibold text-emerald-800">
              <CheckCircle2 size={14} /> Enrolled · meet link opens at class time
            </p>
          )}
        </div>
      </div>
    </MobileBatchCardShell>
  );
}

function BatchDetailModal({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['batch-detail', batch.id],
    queryFn: () => unwrap<BatchDetail>(api.get(`/teacher/batches/${batch.id}/detail`)),
  });
  const t = data?.teacher;

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Batch details</p>
          <h3 className="mt-1 text-xl font-bold text-slate-800">{batch.title}</h3>
          <p className="mt-1 text-sm text-slate-500">{scheduleLabel(batch)}</p>
        </div>
        <span className={`badge shrink-0 ${badgeClass(STATUS_LABEL[batch.status])}`}>{STATUS_LABEL[batch.status]}</span>
      </div>

      <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Teacher</div>
        {isLoading ? (
          <p className="mt-3 text-sm text-slate-400">Loading…</p>
        ) : t ? (
          <div className="mt-3 flex gap-3">
            {t.photo_url ? (
              <img src={t.photo_url} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-white" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-lg font-bold text-brand ring-2 ring-white">
                {t.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1 font-semibold text-slate-800">
                {t.name}
                {t.certified && <Award size={14} className="text-brand-gold" />}
              </div>
              <div className="text-xs text-slate-500">
                {[t.qualification, t.cefr_level ? `CEFR ${t.cefr_level}` : null].filter(Boolean).join(' · ') || '—'}
              </div>
              {t.city && (
                <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                  <MapPin size={12} /> {t.city}
                </div>
              )}
              {t.bio && <p className="mt-2 text-sm text-slate-600">{t.bio}</p>}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Teacher to be assigned.</p>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-slate-100 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Classmates</div>
          <span className="text-xs font-medium text-slate-500">{data?.member_count ?? batch.member_count ?? 0} members</span>
        </div>
        <div className="mt-3">
          {isLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : data && !data.is_member ? (
            <p className="text-sm text-slate-500">Join this batch to see who your classmates are.</p>
          ) : data?.members.length ? (
            <MemberList members={data.members} />
          ) : (
            <p className="text-sm text-slate-500">No members yet.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function BatchStatusPill({ status, live }: { status: Batch['status']; live?: boolean }) {
  if (live) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-600 ring-1 ring-red-500/20">
        <Radio size={11} className="animate-pulse" /> Live
      </span>
    );
  }
  const styles: Record<Batch['status'], string> = {
    member: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    pending: 'bg-amber-50 text-amber-700 ring-amber-200',
    none: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${styles[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function BatchCard({ b, atCap, onJoin, joining, onWithdraw, withdrawing, onDetails, title, hideTitle, past }: {
  b: Batch;
  atCap: boolean;
  onJoin: (id: string) => void;
  joining: boolean;
  onWithdraw: (id: string) => void;
  withdrawing: boolean;
  onDetails: () => void;
  title?: string;
  hideTitle?: boolean;
  past?: boolean;
}) {
  const live = b.status === 'member' && b.meeting_active;
  const memberCount = b.member_count ?? 0;

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 ${
        past
          ? 'border-slate-200/70 opacity-90'
          : live
            ? 'hover:-translate-y-0.5 hover:shadow-md border-red-200/80 ring-1 ring-red-100'
            : 'hover:-translate-y-0.5 hover:shadow-md border-slate-200/80 hover:border-brand/30'
      }`}
    >
      <div className="relative">
        <BatchScheduleHighlight batch={b} batchId={b.id} />
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <BatchShareButton batchId={b.id} title={b.title} variant="overlay" />
          <BatchStatusPill status={b.status} live={live} />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        {!hideTitle && (
          <h3 className="mb-4 font-semibold tracking-tight text-slate-900 group-hover:text-brand">
            {title ?? b.title}
          </h3>
        )}

        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Instructor</p>
          <div className="mt-2 flex items-center gap-3">
            {b.teacher_name ? (
              <StudentAvatar photoUrl={b.teacher_photo_url} name={b.teacher_name} size="h-9 w-9" iconSize={16} />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-brand">
                <GraduationCap size={16} />
              </span>
            )}
            <span className="font-medium text-slate-800">{b.teacher_name || 'To be assigned'}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onDetails}
          className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-100 px-3.5 py-2.5 text-sm transition hover:border-brand/20 hover:bg-brand/5"
        >
          <span className="inline-flex items-center gap-2 text-slate-600">
            <Users size={15} className="text-slate-400" />
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-brand">
            View roster <ChevronRight size={15} />
          </span>
        </button>

        <div className="mt-4 pt-1">
          {past ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-500">
              <Clock size={15} /> Session ended
            </div>
          ) : (
            <>
              {b.status === 'none' && (
                atCap ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-sm text-slate-500" title="You've reached your plan's batch limit">
                    Plan limit reached — leave a batch to join another
                  </p>
                ) : (
                  <button className="btn-primary w-full py-2.5" disabled={joining} onClick={() => onJoin(b.id)}>
                    {joining ? 'Requesting…' : 'Request to join'}
                  </button>
                )
              )}
              {b.status === 'pending' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-800">
                    <Clock size={15} /> Awaiting teacher approval
                  </div>
                  <button
                    type="button"
                    className="btn-ghost w-full py-2 text-sm text-slate-600"
                    disabled={withdrawing}
                    onClick={() => onWithdraw(b.id)}
                  >
                    {withdrawing ? 'Withdrawing…' : 'Withdraw request'}
                  </button>
                </div>
              )}
              {b.status === 'member' && (
                b.meeting_url ? (
                  <a className="btn-gold flex w-full items-center justify-center gap-2 py-2.5" href={b.meeting_url} target="_blank" rel="noreferrer">
                    <Video size={16} /> Join live session
                  </a>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-800">
                    <CheckCircle2 size={15} /> Enrolled · meet link opens during class
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function filterLabel(f: BatchFilter, count?: number, mobile = false) {
  if (count == null) return f === 'all' ? 'All' : STATUS_LABEL[f];
  const n = count === 1 ? '1 class' : `${count} classes`;
  if (f === 'all') return mobile ? `All · ${n}` : `All (${count})`;
  const label = STATUS_LABEL[f];
  return mobile ? `${label} · ${n}` : `${label} (${count})`;
}

export function BatchesPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [detail, setDetail] = useState<Batch | null>(null);
  const [inviteBatch, setInviteBatch] = useState<Batch | null>(null);
  const [filter, setFilter] = useState<BatchFilter>('all');
  const [search, setSearch] = useState('');
  const [pastOpen, setPastOpen] = useState(false);
  const [mobilePastOpen, setMobilePastOpen] = useState(false);
  const [mobileExpandedEnrolled, setMobileExpandedEnrolled] = useState<string | null>(null);
  const joinId = searchParams.get('join');
  const handledJoin = useRef<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['browse-batches'],
    queryFn: () => unwrap<BrowseBatches>(api.get('/teacher/browse-batches')),
  });

  const join = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/batches/${id}/request-join`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['browse-batches'] }),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/batches/${id}/withdraw-join`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['browse-batches'] }),
  });

  const batches = data?.batches ?? [];
  const limit = data?.batch_limit ?? 0;
  const used = data?.batches_used ?? 0;
  const atCap = limit > 0 && used >= limit;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  const sorted = useMemo(
    () => [...batches].sort((a, b) => {
      const rank = (s: Batch['status']) => (s === 'member' ? 0 : s === 'pending' ? 1 : 2);
      return rank(a.status) - rank(b.status);
    }),
    [batches],
  );

  const enrolled = useMemo(() => sorted.filter((b) => b.status === 'member'), [sorted]);
  const browsable = useMemo(() => sorted.filter((b) => b.status !== 'member'), [sorted]);

  const enrolledActive = useMemo(() => enrolled.filter((b) => batchPeriod(b) !== 'past'), [enrolled]);
  const enrolledPast = useMemo(() => enrolled.filter((b) => batchPeriod(b) === 'past'), [enrolled]);

  const upcomingBrowsable = useMemo(
    () => browsable.filter((b) => isBatchBrowsable(b)),
    [browsable],
  );

  const pastBrowsable = useMemo(
    () => browsable.filter((b) => batchPeriod(b) === 'past'),
    [browsable],
  );

  const stats = useMemo(() => ({
    total: countBatchClasses(upcomingBrowsable),
    enrolled: countBatchClasses(batches.filter((b) => b.status === 'member')),
    pending: countBatchClasses(upcomingBrowsable.filter((b) => b.status === 'pending')),
    open: countBatchClasses(upcomingBrowsable.filter((b) => b.status === 'none')),
  }), [batches, upcomingBrowsable]);

  const statusCounts = useMemo(() => ({
    member: stats.enrolled,
    pending: stats.pending,
    none: stats.open,
  }), [stats]);

  const filtered = useMemo(() => {
    if (filter === 'member') return [...enrolledActive, ...enrolledPast];
    const base = filter === 'all' ? upcomingBrowsable : upcomingBrowsable.filter((b) => b.status === filter);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((b) => batchMatchesSearch(b, q));
  }, [filter, enrolledActive, enrolledPast, upcomingBrowsable, search]);

  const groupedBrowsable = useMemo(() => groupBrowsableBatches(filtered), [filtered]);
  const groupedPastBrowsable = useMemo(() => groupBrowsableBatches(pastBrowsable), [pastBrowsable]);
  const searchActive = search.trim().length > 0;

  const liveBatch = enrolledActive.find((b) => b.meeting_active && !(b.attendance_submitted_dates ?? []).includes(todayIsoIST()));
  const visibleFilters = FILTERS.filter((f) => {
    if (f === 'none' && stats.open > 0 && stats.open === stats.total && stats.pending === 0) return false;
    return f === 'all' || (statusCounts[f] ?? 0) > 0 || filter === f;
  });

  useEffect(() => {
    const hash = location.hash.slice(1);
    if (hash && (enrolledActive.length || enrolledPast.length)) {
      if (enrolledPast.some((b) => hash === `batch-${b.id}`)) setPastOpen(true);
      requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [enrolledActive, enrolledPast]);

  useEffect(() => {
    if (!joinId || isLoading || handledJoin.current === joinId) return;
    const batch = batches.find((b) => b.id === joinId);
    if (!batch) return;
    handledJoin.current = joinId;
    setInviteBatch(batch);
    setDetail(batch);
    if (batch.status === 'member') setFilter('member');
    else if (batch.status === 'pending') setFilter('pending');
    else setFilter('none');
    const next = new URLSearchParams(searchParams);
    next.delete('join');
    setSearchParams(next, { replace: true });
  }, [joinId, isLoading, batches, searchParams, setSearchParams]);

  if (isLoading) return <BatchesSkeleton />;

  return (
    <div className="batches-page -mx-3 space-y-0 sm:-mx-4 md:mx-0 md:space-y-6">
      {/* Mobile: compact feed (matches Videos page) */}
      <div className="md:hidden">
        <div className="border-b border-slate-100 bg-white px-3 py-2.5">
          <h1 className="text-lg font-bold text-slate-900">Teacher-led Batches</h1>
          {stats.total > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">
              {stats.open} open {stats.open === 1 ? 'class' : 'classes'} · {stats.enrolled} enrolled · {stats.pending} pending
            </p>
          )}
        </div>

        {batches.length > 0 && (
          <div className="flex gap-2 overflow-x-auto border-b border-slate-100 bg-white px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleFilters.map((f) => (
              <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {filterLabel(f, f === 'all' ? stats.total : statusCounts[f], true)}
              </FilterChip>
            ))}
          </div>
        )}

        {filter !== 'member' && batches.length > 0 && (
          <div className="border-b border-slate-100 bg-white px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                className="w-full rounded-full border-0 bg-slate-100 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:bg-white focus:shadow-[0_0_0_2px_rgba(47,128,237,0.25)]"
                placeholder="Search batches…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        )}

        {inviteBatch && (
          <div className="border-b border-brand/20 bg-brand/5 px-3 py-3">
            <p className="text-xs font-semibold text-brand">Batch invitation</p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">{inviteBatch.title}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {inviteBatch.status === 'none' && !atCap && (
                <button className="btn-primary py-1.5 text-xs" disabled={join.isPending} onClick={() => join.mutate(inviteBatch.id)}>
                  {join.isPending ? 'Requesting…' : 'Request to join'}
                </button>
              )}
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setInviteBatch(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {liveBatch?.meeting_url && (
          <div className="border-b border-red-200 bg-gradient-to-r from-red-500 to-red-600 px-3 py-3 text-white">
            <p className="inline-flex items-center gap-1 text-xs font-medium text-white/90">
              <Radio size={12} className="animate-pulse" /> Live now
            </p>
            <p className="mt-0.5 text-sm font-bold">{liveBatch.title}</p>
            <a className="btn-gold mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-sm" href={liveBatch.meeting_url} target="_blank" rel="noreferrer">
              <Video size={15} /> Join meeting
            </a>
          </div>
        )}

        {limit > 0 && (
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700">{used} of {limit} batches used</span>
              <Link to="/plans" className="font-semibold text-brand">Upgrade</Link>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
              <div className={`h-full rounded-full ${atCap ? 'bg-amber-400' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {join.isError && (
          <div className="border-b border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            {(join.error as Error).message}
          </div>
        )}

        {(filter === 'all' || filter === 'member') && enrolledActive.length > 0 && (
          <section className="border-b border-slate-100/80 bg-slate-50/50 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 px-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand/10 text-brand">
                <GraduationCap size={11} strokeWidth={2.5} />
              </span>
              <h2 className="text-[13px] font-semibold tracking-tight text-slate-800">Your classes</h2>
              <span className="rounded-full bg-slate-200/80 px-1.5 py-px text-[10px] font-semibold tabular-nums text-slate-500">
                {enrolledActive.length}
              </span>
            </div>
            <div className="space-y-3 bg-slate-50/60 py-3">
              {enrolledActive.map((b) => {
                const expanded = mobileExpandedEnrolled === b.id;
                const live = b.meeting_active;
                const dateIso = batchSessionIso(b);
                const time = batchTimeLabel(b) ?? timeLabel(b);
                const memberCount = b.member_count ?? 0;
                return (
                  <div key={b.id} id={`batch-${b.id}`} className="scroll-mt-20">
                    <MobileBatchCardShell accent={live ? 'live' : 'enrolled'}>
                      <button
                        type="button"
                        className="w-full p-4 text-left transition active:bg-slate-50/80"
                        onClick={() => setMobileExpandedEnrolled(expanded ? null : b.id)}
                      >
                        <div className="flex items-start gap-3.5">
                          {dateIso ? (
                            <MobileBatchDateBadge dateIso={dateIso} />
                          ) : (
                            <span className="flex h-[4.5rem] w-[3.25rem] shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                              <CalendarClock size={22} strokeWidth={1.75} />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                              <BatchStatusPill status="member" live={live} />
                              {time && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-slate-500">
                                  <Clock size={12} className="shrink-0 text-brand/70" />
                                  {time}
                                </span>
                              )}
                            </div>
                            <h3 className="mt-2 line-clamp-2 text-[16px] font-semibold leading-snug tracking-tight text-slate-900">
                              {b.title}
                            </h3>
                            <div className="mt-2.5 flex items-center gap-2.5">
                              {b.teacher_name ? (
                                <StudentAvatar photoUrl={b.teacher_photo_url} name={b.teacher_name} size="h-9 w-9" iconSize={15} />
                              ) : (
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand ring-2 ring-white">
                                  <GraduationCap size={15} />
                                </span>
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800">{b.teacher_name || 'Teacher to be assigned'}</p>
                                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Instructor</p>
                              </div>
                            </div>
                            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">
                              <Users size={13} />
                              {memberCount} {memberCount === 1 ? 'classmate' : 'classmates'} · {expanded ? 'Hide details' : 'Chat & roster'}
                              <ChevronDown size={14} className={`transition ${expanded ? 'rotate-180' : ''}`} />
                            </span>
                          </div>
                        </div>
                      </button>
                      {live && b.meeting_url && (
                        <div className="border-t border-slate-100 px-4 pb-4">
                          <a
                            className="btn-gold flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold shadow-sm active:scale-[0.98]"
                            href={b.meeting_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Video size={16} /> Join live session
                          </a>
                        </div>
                      )}
                      {expanded && (
                        <div className="border-t border-slate-100 px-3 pb-3 pt-1">
                          <StudentEnrolledBatchCard batch={b} />
                        </div>
                      )}
                    </MobileBatchCardShell>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {filter === 'member' && !enrolledActive.length && !enrolledPast.length && (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold text-slate-700">No enrolled batches</p>
            <p className="mt-1 text-sm text-slate-500">Request to join an open batch below.</p>
            <button type="button" className="btn-ghost mt-4 text-sm" onClick={() => setFilter('none')}>
              Browse open batches
            </button>
          </div>
        )}

        {filter !== 'member' && batches.length > 0 && (
          <>
            {!groupedBrowsable.length ? (
              <div className="px-6 py-12 text-center">
                <p className="font-semibold text-slate-700">
                  {searchActive ? 'No batches match your search' : `No ${filter === 'all' ? '' : STATUS_LABEL[filter].toLowerCase()} batches`}
                </p>
                {searchActive && (
                  <button type="button" className="btn-ghost mt-4 text-sm" onClick={() => setSearch('')}>
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-5 bg-slate-50/60 py-3">
                {groupedBrowsable.map((group) => (
                  <section key={batchTitleKey(group[0].title)}>
                    <div className="px-4 pb-2.5">
                      <h3 className="text-base font-bold tracking-tight text-slate-900">{group[0].title}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Next {group.length} upcoming session{group.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="space-y-3">
                      {group.map((b) => (
                        <MobileBrowseBatchRow
                          key={b.id}
                          b={b}
                          hideTitle
                          atCap={atCap}
                          joining={join.isPending}
                          onJoin={join.mutate}
                          withdrawing={withdraw.isPending}
                          onWithdraw={withdraw.mutate}
                          onDetails={() => setDetail(b)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}

        {(filter === 'all' || filter === 'member') && enrolledPast.length > 0 && (
          <section className="border-t border-slate-100 bg-white">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-3 text-left"
              aria-expanded={mobilePastOpen}
              onClick={() => setMobilePastOpen((v) => !v)}
            >
              <Clock size={16} className="shrink-0 text-slate-400" />
              <span className="flex-1 text-sm font-semibold text-slate-800">Past classes ({enrolledPast.length})</span>
              <ChevronDown size={18} className={`shrink-0 text-slate-400 transition ${mobilePastOpen ? 'rotate-180' : ''}`} />
            </button>
            {mobilePastOpen && (
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {enrolledPast.map((b) => (
                  <div key={b.id} id={`batch-${b.id}`} className="scroll-mt-20 px-3 py-3">
                    <StudentEnrolledBatchCard batch={b} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {filter !== 'member' && groupedPastBrowsable.length > 0 && (
          <section className="border-t border-slate-100 bg-white">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <Clock size={14} className="text-slate-400" />
              <h2 className="text-[13px] font-semibold text-slate-600">Past batches</h2>
            </div>
            <div className="space-y-5 bg-slate-50/60 py-3">
              {groupedPastBrowsable.map((group) => (
                <section key={`past-${batchTitleKey(group[0].title)}`}>
                  <div className="px-4 pb-2.5">
                    <h3 className="text-base font-bold tracking-tight text-slate-800">{group[0].title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {group.length} past session{group.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {group.map((b) => (
                      <MobileBrowseBatchRow
                        key={b.id}
                        b={b}
                        past
                        hideTitle
                        atCap={atCap}
                        joining={join.isPending}
                        onJoin={join.mutate}
                        withdrawing={withdraw.isPending}
                        onWithdraw={withdraw.mutate}
                        onDetails={() => setDetail(b)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        )}

        {!batches.length && (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <GraduationCap size={32} />
            </div>
            <h2 className="mt-4 text-base font-bold text-slate-800">No batches yet</h2>
            <p className="mt-2 text-sm text-slate-500">New class batches will appear here when teachers open enrollment.</p>
          </div>
        )}
      </div>

      {/* Desktop: existing layout */}
      <div className="hidden space-y-6 md:block">
      <PageHeader
        title="Teacher-led Batches"
        description="Join a class batch, track your enrollment, and access your meet link when sessions go live"
      />

      {inviteBatch && (
        <div className="card border-brand/25 bg-brand/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-brand">Batch invitation</p>
              <p className="mt-0.5 font-bold text-slate-900">{inviteBatch.title}</p>
              <p className="mt-1 text-sm text-slate-600">
                {inviteBatch.status === 'member'
                  ? 'You are already enrolled in this batch.'
                  : inviteBatch.status === 'pending'
                    ? 'Your join request is awaiting teacher approval.'
                    : atCap
                      ? 'Your plan batch limit is full — leave a batch to join this one.'
                      : 'Request to join — subject to your plan batch limit.'}
              </p>
            </div>
            {inviteBatch.status === 'none' && !atCap && (
              <button
                className="btn-primary shrink-0"
                disabled={join.isPending}
                onClick={() => join.mutate(inviteBatch.id)}
              >
                {join.isPending ? 'Requesting…' : 'Request to join'}
              </button>
            )}
            <button type="button" className="btn-ghost shrink-0 text-sm" onClick={() => setInviteBatch(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {stats.total > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-5 text-white sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90">
                  <Sparkles size={14} /> Your batches
                </p>
                <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">
                  {stats.open} open · {stats.enrolled} enrolled · {stats.pending} pending
                </h2>
                <p className="mt-1 text-sm text-white/80">Request to join — your meet link appears when class is live</p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <GraduationCap size={28} />
              </div>
            </div>
          </div>
        </div>
      )}

      {enrolledActive.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Your enrolled batches</h2>
              <p className="mt-0.5 text-sm text-slate-500">Schedule, teacher, meet link and classmates</p>
            </div>
            <span className="text-sm text-slate-400">{enrolledActive.length} active</span>
          </div>
          <div className="space-y-6">
            {enrolledActive.map((b) => (
              <StudentEnrolledBatchCard key={b.id} batch={b} />
            ))}
          </div>
        </section>
      )}

      {enrolledPast.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
            aria-expanded={pastOpen}
            onClick={() => setPastOpen((v) => !v)}
          >
            <span className="rounded-lg bg-slate-100 p-2 text-slate-600">
              <Clock size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-800">Past enrolled batches</h2>
              <p className="mt-0.5 text-sm text-slate-500">Sessions that have ended — review and feedback</p>
            </div>
            <span className="hidden text-sm text-slate-400 sm:inline">{enrolledPast.length} past</span>
            <ChevronDown
              size={20}
              className={`shrink-0 text-slate-400 transition-transform ${pastOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {pastOpen && (
            <div className="space-y-6 border-t border-slate-100 px-5 py-5">
              {enrolledPast.map((b) => (
                <StudentEnrolledBatchCard key={b.id} batch={b} />
              ))}
            </div>
          )}
        </section>
      )}

      {liveBatch?.meeting_url && (
        <div className="card overflow-hidden p-0">
          <div className="bg-gradient-to-r from-red-500 to-red-600 px-6 py-5 text-white sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90">
                  <Radio size={14} className="animate-pulse" /> Session live now
                </p>
                <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">{liveBatch.title}</h2>
                <p className="mt-1 text-sm text-white/80">{scheduleLabel(liveBatch)}</p>
              </div>
              <a className="btn-gold shrink-0" href={liveBatch.meeting_url} target="_blank" rel="noreferrer">
                <Video size={16} /> Join meeting
              </a>
            </div>
          </div>
        </div>
      )}

      {limit > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <Layers size={16} className="text-brand" />
                Batch enrollment
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Your plan allows {limit} active batch{limit === 1 ? '' : 'es'} at a time
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={atCap ? 'Plan limit reached' : `${used} of ${limit} used`} />
              <Link to="/plans" className="btn-gold inline-flex items-center gap-1.5 text-sm">
                <Sparkles size={14} /> Upgrade plan <ArrowRight size={14} />
              </Link>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{used} of {limit} used</span>
              <span className={atCap ? 'font-medium text-amber-600' : 'text-slate-400'}>
                {atCap ? 'Leave a batch to join another' : `${limit - used} slot${limit - used === 1 ? '' : 's'} available`}
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${atCap ? 'bg-amber-400' : 'bg-brand'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {join.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(join.error as Error).message}
        </div>
      )}

      {filter === 'member' && !enrolledActive.length && !enrolledPast.length && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center">
          <p className="font-semibold text-slate-700">No enrolled batches</p>
          <p className="mt-1 text-sm text-slate-500">Request to join an open batch below.</p>
          <button type="button" className="btn-ghost mt-4" onClick={() => setFilter('none')}>
            Browse open batches
          </button>
        </div>
      )}

      {batches.length > 0 && filter !== 'member' && (
        <Section
          title="Class batches"
          icon={Layers}
          description="Upcoming sessions grouped by batch — request to join an open slot"
          count={groupedBrowsable.length}
          toolbar={
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                className="input pl-9"
                placeholder="Search by title, teacher, or batch ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2">
            {visibleFilters.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  filter === f
                    ? 'bg-brand text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-brand/30 hover:bg-brand/5'
                }`}
              >
                {filterLabel(f, f === 'all' ? stats.total : statusCounts[f])}
              </button>
            ))}
          </div>

          {!groupedBrowsable.length ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center">
              <p className="font-semibold text-slate-700">
                {searchActive
                  ? 'No batches match your search'
                  : `No ${filter === 'all' ? '' : STATUS_LABEL[filter].toLowerCase()} batches`}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {searchActive ? 'Try a different keyword or clear the search.' : 'Try another filter to see more batches.'}
              </p>
              {searchActive ? (
                <button type="button" className="btn-ghost mt-4" onClick={() => setSearch('')}>
                  Clear search
                </button>
              ) : filter !== 'all' ? (
                <button type="button" className="btn-ghost mt-4" onClick={() => setFilter('all')}>
                  Show all batches
                </button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-8">
              {groupedBrowsable.map((group) => (
                <div key={batchTitleKey(group[0].title)}>
                  <h3 className="text-lg font-bold text-slate-800">{group[0].title}</h3>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Next {group.length} upcoming session{group.length === 1 ? '' : 's'}
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {group.map((b) => (
                      <BatchCard
                        key={b.id}
                        b={b}
                        hideTitle
                        atCap={atCap}
                        joining={join.isPending}
                        onJoin={join.mutate}
                        withdrawing={withdraw.isPending}
                        onWithdraw={withdraw.mutate}
                        onDetails={() => setDetail(b)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {pastBrowsable.length > 0 && filter !== 'member' && (
        <Section
          title="Past batches"
          icon={Clock}
          description="Sessions whose time slot has ended"
          count={groupedPastBrowsable.length}
        >
          <div className="space-y-8">
            {groupedPastBrowsable.map((group) => (
              <div key={`past-${batchTitleKey(group[0].title)}`}>
                <h3 className="text-lg font-bold text-slate-800">{group[0].title}</h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {group.length} past session{group.length === 1 ? '' : 's'}
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((b) => (
                    <BatchCard
                      key={b.id}
                      b={b}
                      past
                      hideTitle
                      atCap={atCap}
                      joining={join.isPending}
                      onJoin={join.mutate}
                      withdrawing={withdraw.isPending}
                      onWithdraw={withdraw.mutate}
                      onDetails={() => setDetail(b)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {!batches.length && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
            <GraduationCap size={32} />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-800">No batches available yet</h2>
          <p className="mt-2 text-sm text-slate-500">New class batches will appear here when teachers open enrollment.</p>
        </div>
      )}
      </div>

      {detail && <BatchDetailModal batch={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
