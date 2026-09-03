import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  ExternalLink,
  Inbox,
  Loader2,
  Search,
  User,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth';
import { parseApiDate } from '@/lib/datetime';

export { MIN_PASSWORD_LENGTH };


/**
 * The one admin "set a new password" dialog, for staff and students alike.
 *
 * It exists as a shared component because the staff screen used to do this with
 * a single `window.prompt()`: one unmasked box, no confirmation, no record of
 * what was typed. A slip there silently locked the account out — which is how
 * the super admin lost admin@speakedge.in. Typing it twice is the whole point,
 * so never swap this back for a prompt().
 */
export function ResetPasswordModal({
  username,
  label,
  onClose,
  onDone,
}: {
  /** Login handle the backend resolves: staff username or student id. */
  username: string;
  /** Human name shown in the copy. */
  label: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const act = useMutation({
    mutationFn: () => {
      if (pw.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      if (pw !== confirm) throw new Error('Passwords do not match');
      return unwrap(api.post('/admin/users/reset-password', { username, new_password: pw }));
    },
    onSuccess: () => { setError(''); onDone?.(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Reset password</h2>
        <button type="button" className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      <p className="mt-2 text-sm text-slate-500">
        Set a new login password for {label} (<span className="font-mono text-xs">{username}</span>).
        Share it with them directly — it is not emailed, and it cannot be read back afterwards.
      </p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); act.mutate(); }}>
        <div>
          <label className="label" htmlFor="reset-pw">New password</label>
          <input id="reset-pw" className="input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="reset-pw-confirm">Confirm password</label>
          <input id="reset-pw-confirm" className="input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={act.isPending}>
            {act.isPending ? 'Saving…' : 'Update password'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/** Page title + optional description/actions row shared by all admin screens. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyRow({ colSpan, label = 'No records found.' }: { colSpan: number; label?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-6 text-center text-slate-500">
        {label}
      </td>
    </tr>
  );
}

/** Consistent status pill colouring across modules. */
export function badgeClass(status?: string | null): string {
  const s = (status || '').toLowerCase();
  if (['active', 'approved', 'paid', 'success', 'verified', 'received', 'completed', 'converted'].some((k) => s.includes(k)))
    return 'bg-green-100 text-green-700';
  if (['pending', 'created', 'under_review', 'booked', 'requested', 'reserved', 'draft', 'open'].some((k) => s.includes(k)))
    return 'bg-amber-100 text-amber-700';
  if (['rejected', 'failed', 'blocked', 'cancelled', 'suspended', 'lost', 'termination', 'red', 'missed'].some((k) => s.includes(k)))
    return 'bg-red-100 text-red-700';
  if (['refund', 'on_hold', 'archived'].some((k) => s.includes(k))) return 'bg-purple-100 text-purple-700';
  return 'bg-slate-100 text-slate-600';
}

export function StatusBadge({ status }: { status?: string | null }) {
  return <span className={`badge ${badgeClass(status)}`}>{status || '—'}</span>;
}

export const fmtDate = (iso?: string | null) => (iso ? parseApiDate(iso).toLocaleString() : '—');
export const fmtDay = (iso?: string | null) => (iso ? parseApiDate(iso).toLocaleDateString() : '—');
export const rupees = (paise?: number | null) =>
  paise == null ? '—' : `₹${(paise / 100).toLocaleString('en-IN')}`;

/** "2026-07" -> "July 2026" */
export const monthLabel = (m: string) => {
  const [y, mm] = (m || '').split('-');
  const d = new Date(Number(y), Number(mm) - 1, 1);
  return Number.isNaN(d.getTime()) ? m : d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
};

function phoneTelHref(phone?: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned.length >= 3 ? `tel:${cleaned}` : null;
}

/** Clickable phone number — opens the device dialer via tel:. */
export function PhoneLink({ phone, className = '' }: { phone?: string | null; className?: string }) {
  if (!phone) return <>—</>;
  const href = phoneTelHref(phone);
  if (!href) return <>{phone}</>;
  return (
    <a href={href} className={`text-brand hover:underline ${className}`} onClick={(e) => e.stopPropagation()}>
      {phone}
    </a>
  );
}

/** Clickable email — opens the default mail client via mailto:. */
export function EmailLink({ email, className = '' }: { email?: string | null; className?: string }) {
  if (!email) return <>—</>;
  const trimmed = email.trim();
  if (!trimmed.includes('@')) return <>{email}</>;
  return (
    <a href={`mailto:${trimmed}`} className={`text-brand hover:underline ${className}`} onClick={(e) => e.stopPropagation()}>
      {email}
    </a>
  );
}

/** Simple prev/next paginator driven by total + page_size. */
export function Paginator({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-sm">
      <span className="text-slate-500">
        Showing{' '}
        <span className="font-medium text-slate-700">
          {start}–{end}
        </span>{' '}
        of <span className="font-medium text-slate-700">{total}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[4.5rem] text-center text-xs font-medium text-slate-500">
          {page} / {pages}
        </span>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Vertical rule between icon actions in a row toolbar. */
export function RowActionDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200/80" aria-hidden />;
}

/** Compact icon button for DataTable row toolbars. */
export function RowAction({
  icon: Icon,
  label,
  onClick,
  variant = 'default',
  to,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  variant?: 'default' | 'danger' | 'primary' | 'success';
  to?: string;
  disabled?: boolean;
}) {
  const cls =
    variant === 'danger'
      ? 'text-red-500 hover:bg-red-50 hover:text-red-600'
      : variant === 'primary'
        ? 'text-brand hover:bg-brand/10 hover:text-brand'
        : variant === 'success'
          ? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800';
  const shared = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition disabled:pointer-events-none disabled:opacity-40 ${cls}`;
  const icon = <Icon className="h-4 w-4" strokeWidth={2} />;

  if (to) {
    return (
      <Link to={to} className={shared} title={label} aria-label={label}>
        {icon}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={shared}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {icon}
    </button>
  );
}

/** Horizontal icon toolbar for a table row's actions column. */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl border border-slate-200/70 bg-white/90 p-1 shadow-sm backdrop-blur-sm">
      {children}
    </div>
  );
}

/** Centered modal shell used by detail/action dialogs. */
export function Modal({
  children,
  onClose,
  wide,
  fullWidth,
}: {
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Nearly full viewport — for split layouts (e.g. batch detail + chat sidebar). */
  fullWidth?: boolean;
}) {
  const sizeClass = fullWidth
    ? 'max-w-[calc(100vw-2rem)]'
    : wide
      ? 'max-w-3xl'
      : 'max-w-lg';
  return createPortal(
    <div
      className={`fixed inset-0 z-40 flex bg-black/40 p-4 ${fullWidth ? '' : 'items-center justify-center'}`}
      onClick={onClose}
    >
      <div
        className={`card relative w-full ${sizeClass} ${
          fullWidth ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'max-h-[92vh] overflow-y-auto'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {fullWidth && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/80 bg-white/95 text-slate-500 shadow-sm backdrop-blur-sm transition hover:bg-slate-50 hover:text-slate-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function approveMembership(studentId: string, plan: string) {
  return unwrap(api.post(`/membership/${studentId}/approve`, null, { params: { plan } }));
}

/** Pick the membership plan when approving a student from the verification queue. */
export function ApprovePlanModal({
  studentName,
  suggestedPlan,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  studentName: string;
  suggestedPlan?: string | null;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (plan: string) => void;
}) {
  const plans = useQuery({
    queryKey: ['plan-options'],
    queryFn: () => unwrap<{ plan: string; label: string; enabled?: boolean }[]>(
      api.get('/payments/plans'),
    ),
  });
  const options = (plans.data ?? []).filter((p) => p.enabled !== false);
  const [plan, setPlan] = useState(suggestedPlan ?? '');

  useEffect(() => {
    if (suggestedPlan) setPlan(suggestedPlan);
  }, [suggestedPlan]);

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-bold">Approve membership</h2>
      <p className="mt-1 text-sm text-slate-500">
        Choose the membership {studentName} paid for. This is what they will receive once approved.
      </p>
      <div className="mt-4">
        <label className="label" htmlFor="approve-plan">Membership *</label>
        <select
          id="approve-plan"
          className="input"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          autoFocus
        >
          <option value="" disabled>Select a membership…</option>
          {options.map((p) => (
            <option key={p.plan} value={p.plan}>{p.label}</option>
          ))}
        </select>
        {suggestedPlan && (
          <p className="mt-1 text-xs text-slate-500">
            Already on this code or account: {options.find((p) => p.plan === suggestedPlan)?.label ?? suggestedPlan}
          </p>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !plan}
          onClick={() => onConfirm(plan)}
        >
          {busy ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Authenticated file download (CSV/XLSX/PDF). Streams the blob through the
 * axios instance so the bearer token is attached, then triggers a browser save.
 */
export async function downloadExport(path: string, params: Record<string, unknown>, filename: string) {
  try {
    const res = await api.get(path, { params, responseType: 'blob' });
    const blob = res.data as Blob;
    if (blob.type.includes('json')) {
      const body = JSON.parse(await blob.text()) as { error?: { message?: string }; message?: string };
      throw new Error(body.error?.message || body.message || 'Download failed');
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking in the same turn races the browser's download (especially on a
    // fast same-origin production host) and iOS ignores <a download> until the
    // navigation has started — wait a beat.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    const err = e as { response?: { data?: Blob }; message?: string };
    let msg = err.message || 'Download failed';
    if (err.response?.data instanceof Blob) {
      try {
        const body = JSON.parse(await err.response.data.text()) as { error?: { message?: string }; message?: string };
        msg = body.error?.message || body.message || msg;
      } catch { /* keep msg */ }
    }
    window.alert(msg);
  }
}

/* ------------------------------------------------------------------ *
 *  DataTable — modern, reusable table with search, sort, filter &     *
 *  pagination. Client-side by default; pass `externalPaginator` (and  *
 *  pre-sliced rows) to drive pagination server-side instead.          *
 * ------------------------------------------------------------------ */

export type SortDir = 'asc' | 'desc';

export interface Column<T> {
  /** Stable key; also the default sort field name. */
  key: string;
  header: ReactNode;
  /** Cell renderer. Defaults to String((row as any)[key]). */
  cell?: (row: T) => ReactNode;
  /** Return a comparable value to make the column sortable. */
  sort?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  className?: string;
  thClassName?: string;
  /** Fixed column width, e.g. '1%' to shrink an actions column. */
  width?: string;
}

interface DataTableProps<T> {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  /** Build the searchable haystack for a row; enables the search box. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** Extra toolbar controls on the left (filter dropdowns). */
  filters?: ReactNode;
  /** Toolbar controls on the right (export buttons, etc.). */
  toolbarRight?: ReactNode;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyLabel?: string;
  initialSort?: { key: string; dir: SortDir };
  /** Client-side page size. Ignored when `externalPaginator` is set. */
  pageSize?: number;
  /** Provide to render your own (server-side) paginator; disables slicing. */
  externalPaginator?: ReactNode;
  /** Optional full-width row rendered directly beneath a data row (e.g. expand panel). */
  renderAfterRow?: (row: T) => ReactNode | null;
  isRowExpanded?: (row: T) => boolean;
}

const alignClass = (a?: 'left' | 'right' | 'center') =>
  a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Search…',
  filters,
  toolbarRight,
  onRowClick,
  loading = false,
  emptyLabel = 'No records found.',
  initialSort,
  pageSize = 10,
  externalPaginator,
  renderAfterRow,
  isRowExpanded,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);
  const [page, setPage] = useState(1);
  const clientPaged = !externalPaginator;

  const allRows = rows ?? [];

  const filtered = useMemo(() => {
    if (!searchText || !query.trim()) return allRows;
    const q = query.trim().toLowerCase();
    return allRows.filter((r) => searchText(r).toLowerCase().includes(q));
  }, [allRows, query, searchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sort!(a);
      const bv = col.sort!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [filtered, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = clientPaged ? sorted.slice((safePage - 1) * pageSize, safePage * pageSize) : sorted;

  // Reset to first page whenever the result set changes.
  useEffect(() => {
    setPage(1);
  }, [query, allRows.length, sort]);

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const showToolbar = searchText || filters || toolbarRight;
  const isFiltered = Boolean(query.trim()) || sorted.length !== allRows.length;

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
      {showToolbar && (
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center">
          {searchText && (
            <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {!loading && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {sorted.length.toLocaleString()} {sorted.length === 1 ? 'row' : 'rows'}
                {isFiltered && allRows.length !== sorted.length ? ` of ${allRows.length.toLocaleString()}` : ''}
              </span>
            )}
            {toolbarRight}
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-slate-50/40 px-3 pb-3 pt-1">
        <table className="w-full border-separate border-spacing-y-2 text-sm [border-spacing:0_0.5rem]">
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={`whitespace-nowrap px-4 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 ${alignClass(c.align)} ${c.sort ? 'cursor-pointer select-none transition hover:text-brand' : ''} ${active ? 'text-brand' : ''} ${c.thClassName ?? ''}`}
                    onClick={c.sort ? () => toggleSort(c.key) : undefined}
                  >
                    <span className={`inline-flex items-center gap-1.5 ${c.align === 'right' ? 'flex-row-reverse' : ''}`}>
                      {c.header}
                      {c.sort &&
                        (active ? (
                          sort!.dir === 'asc' ? (
                            <ChevronUp className="h-3.5 w-3.5 text-brand" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-brand" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 text-slate-300" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand/60" />
                  <p className="mt-3 text-sm text-slate-400">Loading…</p>
                </td>
              </tr>
            ) : visible.length ? (
              visible.map((row, i) => {
                const key = rowKey(row, i);
                const expanded = isRowExpanded?.(row) ?? false;
                const after = renderAfterRow?.(row);
                return (
                  <Fragment key={key}>
                    <tr
                      className={`group transition-transform duration-200 hover:-translate-y-0.5 ${onRowClick ? 'cursor-pointer' : ''} ${expanded ? 'relative z-[1]' : ''}`}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                    >
                      {columns.map((c, ci) => (
                        <td
                          key={c.key}
                          className={`border-y border-slate-200/70 bg-white px-4 py-4 align-middle text-slate-700 transition-colors group-hover:border-slate-300/70 group-hover:bg-white ${ci === 0 ? `rounded-l-xl border-l-[3px] pl-5 ${expanded ? 'border-l-brand' : 'border-l-slate-200/70 group-hover:border-l-brand'}` : ''} ${ci === columns.length - 1 ? 'rounded-r-xl border-r border-slate-200/70 shadow-[2px_4px_12px_-2px_rgba(15,23,42,0.06)] group-hover:shadow-[2px_6px_16px_-2px_rgba(15,23,42,0.1)]' : ''} ${expanded ? 'border-brand/25 bg-brand/[0.02]' : ''} ${alignClass(c.align)} ${c.className ?? ''}`}
                        >
                          {c.cell ? c.cell(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                    {after && (
                      <tr className="relative z-0">
                        <td colSpan={columns.length} className="border-x border-b border-brand/15 bg-gradient-to-b from-brand/[0.04] to-white px-4 pb-4 pt-0 shadow-[inset_0_2px_8px_-4px_rgba(15,23,42,0.08)]">
                          {after}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={columns.length} className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-16 text-center">
                  <Inbox className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm text-slate-500">{emptyLabel}</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {externalPaginator ??
        (clientPaged && sorted.length > pageSize && (
          <Paginator page={safePage} pageSize={pageSize} total={sorted.length} onPage={setPage} />
        ))}
    </div>
  );
}

/** Segmented pill filter for DataTable toolbars. */
export function TableFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-slate-100/90 p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value || '__all__'}
            type="button"
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              active
                ? 'bg-white text-brand shadow-sm ring-1 ring-slate-200/80'
                : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export type StatAccent = 'brand' | 'emerald' | 'amber' | 'violet' | 'rose' | 'sky' | 'slate';

const STAT_ACCENTS: Record<StatAccent, { chip: string; value: string; glow: string }> = {
  brand: { chip: 'bg-brand/10 text-brand', value: 'text-brand', glow: 'from-brand/[0.07]' },
  emerald: { chip: 'bg-emerald-100 text-emerald-600', value: 'text-emerald-600', glow: 'from-emerald-500/[0.07]' },
  amber: { chip: 'bg-amber-100 text-amber-600', value: 'text-amber-600', glow: 'from-amber-500/[0.08]' },
  violet: { chip: 'bg-violet-100 text-violet-600', value: 'text-violet-600', glow: 'from-violet-500/[0.07]' },
  rose: { chip: 'bg-rose-100 text-rose-600', value: 'text-rose-600', glow: 'from-rose-500/[0.07]' },
  sky: { chip: 'bg-sky-100 text-sky-600', value: 'text-sky-600', glow: 'from-sky-500/[0.07]' },
  slate: { chip: 'bg-slate-100 text-slate-600', value: 'text-slate-700', glow: 'from-slate-500/[0.06]' },
};

/**
 * Stat tile for dashboard/overview grids. All extras are optional so existing
 * call sites keep the plain label/value/hint look; pass `icon`/`accent` for a
 * colour-coded KPI, `to` to make it a link, and `delta` for a trend pill.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'brand',
  to,
  delta,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  accent?: StatAccent;
  to?: string;
  /** Percent change vs the prior period; renders an up/down pill. */
  delta?: number | null;
}) {
  const theme = STAT_ACCENTS[accent];
  const up = delta != null && delta >= 0;
  const body = (
    <div
      className={`card relative overflow-hidden ${to ? 'transition duration-200 hover:-translate-y-0.5 hover:shadow-md' : ''}`}
    >
      <div className={`pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gradient-to-b ${theme.glow} to-transparent`} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="text-sm text-slate-500">{label}</div>
        {Icon && (
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${theme.chip}`}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
        )}
      </div>
      <div className="relative mt-2 flex items-baseline gap-2">
        <span className={`text-3xl font-extrabold ${theme.value}`}>{value}</span>
        {delta != null && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
            {up ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {hint && <div className="relative mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

function genderAvatar(gender?: string | null): { Icon: LucideIcon; className: string } | null {
  switch (gender?.toLowerCase()) {
    case 'male':
      return { Icon: User, className: 'bg-sky-100 text-sky-600' };
    case 'female':
      return { Icon: UserRound, className: 'bg-rose-100 text-rose-600' };
    case 'other':
      return { Icon: Users, className: 'bg-violet-100 text-violet-600' };
    default:
      return null;
  }
}

/** Student photo, gender icon, or initial — shared across admin screens. */
export function StudentAvatar({
  photoUrl,
  gender,
  name,
  size = 'h-9 w-9',
  iconSize = 18,
}: {
  photoUrl?: string | null;
  gender?: string | null;
  name: string;
  size?: string;
  iconSize?: number;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  const showPhoto = Boolean(photoUrl) && !failed;

  if (showPhoto) {
    return (
      <img
        src={photoUrl!}
        alt=""
        className={`${size} shrink-0 rounded-full object-cover bg-slate-100 ring-2 ring-slate-200/80 transition-shadow group-hover:ring-brand/40`}
        onError={() => setFailed(true)}
        onLoad={(e) => {
          if (e.currentTarget.naturalWidth === 0) setFailed(true);
        }}
      />
    );
  }

  const avatar = genderAvatar(gender);
  if (avatar) {
    const Icon = avatar.Icon;
    return (
      <div className={`flex ${size} shrink-0 items-center justify-center rounded-full ring-2 ring-transparent transition-shadow group-hover:ring-brand/30 ${avatar.className}`}>
        <Icon size={iconSize} aria-hidden />
      </div>
    );
  }

  return (
    <div className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-500 ring-2 ring-transparent transition-shadow group-hover:ring-brand/30`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export interface TeacherOption {
  id: string;
  name: string;
  photo_url?: string | null;
  teacher_id?: string | null;
}

/** Teacher picker with profile photos (native select cannot show images). */
export function TeacherSelect({
  value,
  onChange,
  teachers,
  placeholder = 'Select a teacher…',
}: {
  value: string;
  onChange: (id: string) => void;
  teachers: TeacherOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = teachers.find((t) => t.id === value);

  return (
    <div>
      <button
        type="button"
        className="input flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <>
            <StudentAvatar photoUrl={selected.photo_url} name={selected.name} size="h-7 w-7" iconSize={14} />
            <span className="min-w-0 flex-1 truncate">{selected.name}</span>
          </>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm" role="listbox">
          <button
            type="button"
            className="flex w-full items-center px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-50"
            onClick={() => { onChange(''); setOpen(false); }}
          >
            {placeholder}
          </button>
          {teachers.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={t.id === value}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${t.id === value ? 'bg-brand/5 text-brand' : ''}`}
              onClick={() => { onChange(t.id); setOpen(false); }}
            >
              <StudentAvatar photoUrl={t.photo_url} name={t.name} size="h-8 w-8" iconSize={16} />
              <span className="min-w-0 flex-1 truncate">
                {t.name}
                {t.teacher_id ? ` (${t.teacher_id})` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface StudentPreviewData {
  student_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  age?: number | null;
  gender?: string | null;
  state?: string | null;
  district?: string | null;
  photo_url?: string | null;
  membership_status: string;
  cefr_status: string;
  cefr_level?: string | null;
  created_at: string;
  is_archived?: boolean;
}

function PreviewRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-2 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="min-w-0 truncate text-slate-700">{value ?? '—'}</span>
    </div>
  );
}

function StudentHoverPreview({
  data,
  loading,
  error,
  style,
  onMouseEnter,
  onMouseLeave,
}: {
  data?: StudentPreviewData;
  loading: boolean;
  error: boolean;
  style: CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const location = [data?.district, data?.state].filter(Boolean).join(', ');

  return (
    <div
      role="tooltip"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="pointer-events-auto w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
    >
      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-full bg-slate-100" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-28 rounded bg-slate-100" />
              <div className="h-3 w-20 rounded bg-slate-100" />
            </div>
          </div>
          <div className="h-3 w-full rounded bg-slate-50" />
          <div className="h-3 w-4/5 rounded bg-slate-50" />
        </div>
      )}
      {!loading && error && <p className="text-xs text-red-600">Could not load student info.</p>}
      {!loading && data && (
        <>
          <div className="flex items-start gap-2.5">
            <StudentAvatar photoUrl={data.photo_url} gender={data.gender} name={data.full_name} size="h-10 w-10" iconSize={20} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900">{data.full_name}</p>
              <p className="truncate font-mono text-xs text-slate-400">{data.student_id}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className={`badge text-[10px] ${badgeClass(data.membership_status)}`}>{data.membership_status}</span>
                <span className="badge bg-slate-100 text-[10px] text-slate-600">{data.cefr_status}</span>
                {data.cefr_level && <span className="badge bg-slate-100 text-[10px] text-slate-600">Level {data.cefr_level}</span>}
                {data.is_archived && <span className="badge bg-purple-100 text-[10px] text-purple-700">Archived</span>}
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
            <PreviewRow label="Email" value={<EmailLink email={data.email} className="text-xs" />} />
            <PreviewRow label="Phone" value={<PhoneLink phone={data.phone} className="text-xs" />} />
            <PreviewRow label="WhatsApp" value={<PhoneLink phone={data.whatsapp} className="text-xs" />} />
            <PreviewRow
              label="Age / Gender"
              value={[data.age != null ? String(data.age) : null, data.gender].filter(Boolean).join(' · ') || undefined}
            />
            <PreviewRow label="Location" value={location || undefined} />
            <PreviewRow label="Joined" value={fmtDay(data.created_at)} />
          </div>
        </>
      )}
    </div>
  );
}

/** Student name/id link to the admin profile page — avatar, hover preview, external icon. */
export function AdminStudentLink({
  studentId,
  name,
  photoUrl,
  gender,
  subtitle,
  avatarSize,
  iconSize,
  showAvatar = true,
  className = '',
}: {
  studentId: string;
  name?: string | null;
  photoUrl?: string | null;
  gender?: string | null;
  subtitle?: ReactNode;
  avatarSize?: string;
  iconSize?: number;
  showAvatar?: boolean;
  className?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const showTimer = useRef<number>();
  const hideTimer = useRef<number>();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-student-preview', studentId],
    queryFn: () => unwrap<StudentPreviewData>(api.get(`/admin/students/${studentId}`)),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const updatePos = () => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cardH = 260;
    const below = rect.bottom + 8;
    const above = rect.top - cardH - 8;
    const top = below + cardH > window.innerHeight - 8 && above > 8 ? above : below;
    setPos({ top, left: Math.min(rect.left, window.innerWidth - 296) });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open]);

  useEffect(
    () => () => {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const scheduleShow = () => {
    window.clearTimeout(hideTimer.current);
    showTimer.current = window.setTimeout(() => setOpen(true), 300);
  };

  const scheduleHide = () => {
    window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  const cancelHide = () => window.clearTimeout(hideTimer.current);

  const displayName = name?.trim() || studentId;
  const subtitleLine = subtitle ?? (name && name !== studentId ? studentId : null);

  return (
    <span
      ref={anchorRef}
      className="relative inline-block max-w-full"
      onMouseEnter={scheduleShow}
      onMouseLeave={scheduleHide}
    >
      <Link
        to={`/admin/students/${studentId}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`group -mx-1 inline-flex max-w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100/90 ${className}`}
      >
        {showAvatar && (
          <StudentAvatar
            photoUrl={photoUrl}
            gender={gender}
            name={displayName}
            size={avatarSize}
            iconSize={iconSize}
          />
        )}
        <span className="min-w-0">
          <span className="block truncate font-medium text-slate-800 transition-colors group-hover:text-brand">
            {displayName}
          </span>
          {subtitleLine && (
            <span className="block truncate font-mono text-xs text-slate-400">{subtitleLine}</span>
          )}
        </span>
        <ExternalLink
          size={13}
          className="shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </Link>
      {open &&
        pos &&
        createPortal(
          <StudentHoverPreview
            data={data}
            loading={isLoading}
            error={isError}
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
          />,
          document.body,
        )}
    </span>
  );
}
