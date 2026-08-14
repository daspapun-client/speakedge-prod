import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Clock, Radio, Search, Trash2, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { parseApiDate, todayIsoIST } from '@/lib/datetime';
import { scheduleDateParts } from '@/features/batch/shared';
import { Paginator, StudentAvatar, TableFilter } from './_shared';

export interface AdminListBatch {
  id: string;
  title: string;
  series_id?: string | null;
  series_title?: string | null;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_photo_url?: string | null;
  teacher_count?: number;
  day_of_week?: string | null;
  date?: string | null;
  class_dates?: string[];
  class_time?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  meeting_active: boolean;
  members: { student_id: string; name: string; photo_url?: string | null; gender?: string | null }[];
  attendance_submitted_dates?: string[];
  linked_batch_ids?: string[];
  class_sessions?: BatchSession[];
}

export interface BatchSession {
  date: string;
  batch_id: string;
  id?: string;
  teacher_id?: string | null;
  teacher_name?: string | null;
  teacher_photo_url?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  class_time?: string | null;
  member_count?: number;
  meeting_active?: boolean;
  meeting_url?: string | null;
  attendance_done?: boolean;
}

export function findAdminListBatch(rows: AdminListBatch[], batchId: string) {
  return rows.find((b) => b.id === batchId || b.linked_batch_ids?.includes(batchId));
}

function batchSessions(b: AdminListBatch) {
  if (b.class_sessions?.length) return b.class_sessions;
  const dates = b.class_dates?.length ? b.class_dates : b.date ? [b.date] : [];
  const member_count = b.members.length;
  return dates.map((d) => ({
    date: d,
    batch_id: b.id,
    teacher_id: b.teacher_id,
    teacher_name: b.teacher_name,
    teacher_photo_url: b.teacher_photo_url,
    member_count,
  }));
}

export function batchTime(b: AdminListBatch) {
  if (b.slot_start && b.slot_end) return `${b.slot_start}–${b.slot_end}`;
  return b.class_time ?? null;
}

export function batchMeta(b: AdminListBatch) {
  const sessions = [...batchSessions(b)].sort((a, z) => a.date.localeCompare(z.date));
  const att = new Set(b.attendance_submitted_dates ?? []);
  const today = todayIsoIST();
  const done = sessions.filter((s) => att.has(s.date)).length;
  const upcoming = sessions.filter((s) => s.date >= today && !att.has(s.date));
  const next = upcoming[0] ?? null;
  const first = sessions[0]?.date ?? null;
  const last = sessions[sessions.length - 1]?.date ?? null;
  return { sessions, done, total: sessions.length, next, first, last, today, isLive: b.meeting_active };
}

export function isMultiClass(b: AdminListBatch) {
  return batchMeta(b).total > 1;
}

// A row is a course (parent) when it aggregates a BatchSeries. Its `id` is the
// series id — not a Batch — so it must always open the series page, where the
// per-session sub-batches are managed.
export function isParentBatch(b: AdminListBatch) {
  return !!b.series_id;
}

export function adminBatchDetailsPath(b: AdminListBatch) {
  return isParentBatch(b) ? `/admin/batches/${b.id}/series` : `/admin/batches/${b.id}`;
}

export function findAdminListBatchByPrimaryId(rows: AdminListBatch[], batchId: string) {
  return rows.find((b) => b.id === batchId);
}

export function findParentBatchForChild(rows: AdminListBatch[], batchId: string) {
  return rows.find((b) => isParentBatch(b) && b.linked_batch_ids?.includes(batchId));
}

function fmtClassDay(d: string) {
  return parseApiDate(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtShortDate(d: string) {
  return parseApiDate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Per-class teacher — never fall back to the series default when this session has its own id. */
function sessionTeacher(s: BatchSession, batch: AdminListBatch) {
  const ownTeacher = !!s.teacher_id && s.teacher_id !== batch.teacher_id;
  return {
    teacherId: s.teacher_id ?? batch.teacher_id,
    teacherName: s.teacher_name ?? (ownTeacher ? null : batch.teacher_name),
    teacherPhoto: s.teacher_photo_url ?? (ownTeacher ? null : batch.teacher_photo_url),
  };
}

function sessionTime(s: BatchSession, batch: AdminListBatch) {
  if (s.slot_start && s.slot_end) return `${s.slot_start}–${s.slot_end}`;
  return s.class_time ?? batchTime(batch);
}

function ClassSessionCard({
  session,
  batch,
  done,
  isToday,
  selected,
  onToggleSelect,
  onDelete,
  deleting,
  onOpen,
}: {
  session: BatchSession;
  batch: AdminListBatch;
  done: boolean;
  isToday: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  deleting: boolean;
  onOpen: () => void;
}) {
  const date = scheduleDateParts(session.date);
  const timeLabel = sessionTime(session, batch);
  const { teacherName, teacherId, teacherPhoto } = sessionTeacher(session, batch);
  const members = session.member_count ?? batch.members.length;

  const accent =
    selected
      ? 'border-l-brand bg-brand/[0.04] ring-2 ring-brand/25'
      : isToday && !done
        ? 'border-l-amber-400 bg-gradient-to-br from-amber-50/90 to-white ring-amber-100/80 hover:ring-amber-200'
        : done
          ? 'border-l-emerald-400 bg-gradient-to-br from-emerald-50/50 to-white ring-emerald-100/60 hover:ring-emerald-200'
          : 'border-l-slate-200 bg-white ring-slate-200/70 hover:border-l-brand/40 hover:ring-brand/15';

  return (
    <div
      role="button"
      tabIndex={0}
      title="Manage this class"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(); }}
      className={`group relative flex cursor-pointer flex-col rounded-xl border border-l-4 p-3 shadow-sm ring-1 transition hover:shadow-md ${accent}`}
    >
      <div className="absolute left-2 top-2 z-10">
        <input
          type="checkbox"
          className="accent-brand"
          checked={selected}
          aria-label={`Select class on ${date?.fullLabel ?? session.date}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
        />
      </div>

      <div className="flex items-start justify-between gap-2 pl-6">
        {date ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex w-11 shrink-0 flex-col overflow-hidden rounded-lg bg-white text-center shadow-sm ring-1 ring-slate-200/80">
              <div className="bg-brand px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                {date.month}
              </div>
              <div className="px-1 py-1.5">
                <span className="text-lg font-bold leading-none text-slate-900">{date.day}</span>
                <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">{date.weekdayShort}</p>
              </div>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{date.fullLabel}</p>
              {timeLabel && (
                <p className="mt-0.5 flex items-center gap-1 text-xs font-medium tabular-nums text-slate-600">
                  <Clock size={12} className="shrink-0 text-brand/70" />
                  {timeLabel}
                </p>
              )}
            </div>
          </div>
        ) : (
          <span className="text-sm text-slate-400">—</span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {done ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Done</span>
          ) : isToday ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Today</span>
          ) : null}
          <button
            type="button"
            title="Delete this class"
            disabled={deleting}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-40"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100/80 pt-2.5">
        <div className="min-w-0 flex-1">
          {teacherId && teacherName ? (
            <Link
              to={`/admin/teachers/${teacherId}`}
              className="inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-brand hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <StudentAvatar photoUrl={teacherPhoto} name={teacherName} size="h-5 w-5" iconSize={10} />
              <span className="truncate">{teacherName}</span>
            </Link>
          ) : (
            <span className="text-xs text-slate-500">{teacherName ?? 'No teacher'}</span>
          )}
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
            <Users size={11} className="shrink-0 text-slate-400" />
            {members} student{members === 1 ? '' : 's'}
          </p>
        </div>
        <ChevronRight size={14} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand/60" />
      </div>
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-gold transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] font-medium text-slate-400">{value} of {max} classes · {pct}%</p>
    </div>
  );
}

type ClassFilter = 'all' | 'upcoming' | 'done' | 'today';

export function BatchClassesPanel({
  batch,
  layout = 'page',
}: {
  batch: AdminListBatch;
  layout?: 'embedded' | 'page';
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ClassFilter>('upcoming');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const meta = batchMeta(batch);
  const att = new Set(batch.attendance_submitted_dates ?? []);
  const time = batchTime(batch);
  const pageSize = layout === 'page' ? 9 : 6;

  const sessionsByBatchId = useMemo(
    () => new Map(meta.sessions.map((s) => [s.batch_id, s])),
    [meta.sessions],
  );

  const filtered = meta.sessions.filter((s) => {
    if (filter === 'upcoming' && (s.date < meta.today || att.has(s.date))) return false;
    if (filter === 'done' && !att.has(s.date)) return false;
    if (filter === 'today' && s.date !== meta.today) return false;
    if (q.trim()) {
      const hay = `${fmtClassDay(s.date)} ${s.date} ${time ?? ''} ${s.teacher_name ?? batch.teacher_name ?? ''}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [filter, q, batch.id]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageBatchIds = paged.map((s) => s.batch_id);
  const allPageSelected = pageBatchIds.length > 0 && pageBatchIds.every((id) => selected.has(id));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-batches'] });

  const removeFromSelection = (batchIds: string[]) => {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const id of batchIds) next.delete(id);
      return next;
    });
  };

  const delOne = useMutation({
    mutationFn: (batchId: string) => unwrap(api.delete(`/teacher/batches/${batchId}`)),
    onSuccess: (_d, batchId) => {
      removeFromSelection([batchId]);
      refresh();
    },
  });

  const bulkDel = useMutation({
    mutationFn: (batchIds: string[]) =>
      unwrap(api.post('/teacher/admin/batches/bulk-delete', { batch_ids: batchIds })),
    onSuccess: (_d, batchIds) => {
      removeFromSelection(batchIds);
      setSelected(new Set());
      refresh();
    },
  });

  const toggleOne = (batchId: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(batchId) ? next.delete(batchId) : next.add(batchId);
      return next;
    });

  const togglePage = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allPageSelected) {
        for (const id of pageBatchIds) next.delete(id);
      } else {
        for (const id of pageBatchIds) next.add(id);
      }
      return next;
    });

  const confirmDeleteOne = (session: BatchSession) => {
    const label = fmtClassDay(session.date);
    if (!window.confirm(`Delete class on ${label}? It can be restored from Archive for 60 days.`)) return;
    delOne.mutate(session.batch_id);
  };

  const confirmBulkDelete = () => {
    const batchIds = [...selected];
    if (!batchIds.length) return;
    const labels = batchIds
      .map((id) => sessionsByBatchId.get(id))
      .filter(Boolean)
      .map((s) => fmtClassDay(s!.date));
    const preview = labels.length <= 3
      ? labels.join(', ')
      : `${labels.slice(0, 3).join(', ')} and ${labels.length - 3} more`;
    if (!window.confirm(`Delete ${batchIds.length} class(es) (${preview})? They can be restored from Archive for 60 days.`)) return;
    bulkDel.mutate(batchIds);
  };

  const deletingId = delOne.isPending ? delOne.variables : null;
  const deleting = delOne.isPending || bulkDel.isPending;

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">Class schedule</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {meta.first && meta.last ? `${fmtShortDate(meta.first)} – ${fmtShortDate(meta.last)}` : '—'}
            {time ? ` · ${time}` : ''}
          </p>
          {meta.isLive && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700">
              <Radio size={12} className="animate-pulse" /> Live now
            </span>
          )}
          <div className="mt-3 max-w-xs">
            <ProgressBar value={meta.done} max={meta.total} />
          </div>
        </div>
        <div className="relative min-w-[10rem] flex-1 sm:max-w-[14rem]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            placeholder="Search dates…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TableFilter
          value={filter}
          onChange={(v) => setFilter(v as ClassFilter)}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'today', label: 'Today' },
            { value: 'done', label: 'Completed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <span className="text-xs text-slate-400">{filtered.length} shown</span>
        {filtered.length > 0 && (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" className="accent-brand" checked={allPageSelected} onChange={togglePage} />
            Select page
          </label>
        )}
        {selected.size > 0 && (
          <>
            <span className="text-xs font-medium text-slate-600">{selected.size} selected</span>
            <button
              type="button"
              className="btn-ghost py-1.5 text-xs text-red-600 hover:bg-red-50"
              disabled={deleting}
              onClick={confirmBulkDelete}
            >
              {bulkDel.isPending ? 'Deleting…' : 'Delete selected'}
            </button>
            <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </>
        )}
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-100 bg-slate-50/50">
        {!filtered.length ? (
          <p className="py-6 text-center text-xs text-slate-400">No classes match this filter.</p>
        ) : (
          <>
            <div className="grid gap-2.5 p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
              {paged.map((s) => (
                <ClassSessionCard
                  key={`${s.batch_id}-${s.date}`}
                  session={s}
                  batch={batch}
                  done={att.has(s.date)}
                  isToday={s.date === meta.today}
                  selected={selected.has(s.batch_id)}
                  onToggleSelect={() => toggleOne(s.batch_id)}
                  onDelete={() => confirmDeleteOne(s)}
                  deleting={deleting && (deletingId === s.batch_id || selected.has(s.batch_id))}
                  onOpen={() => navigate(`/admin/batches/${s.batch_id}`)}
                />
              ))}
            </div>
            <Paginator page={safePage} pageSize={pageSize} total={filtered.length} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
