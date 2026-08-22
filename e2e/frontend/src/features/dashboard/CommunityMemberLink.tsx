import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { StudentAvatar } from '@/features/admin/_shared';

interface MemberPreview {
  student_id: string;
  display_name?: string | null;
  first_name?: string | null;
  age?: number | null;
  gender?: string | null;
  photo_url?: string | null;
  cefr_level?: string | null;
  cefr_status?: string | null;
  bio?: string | null;
  looking_for_partner?: boolean;
  friends_count: number;
  teams: { id: string; name: string; members: number }[];
}

function PreviewRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-2 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="min-w-0 truncate text-slate-700">{value ?? '—'}</span>
    </div>
  );
}

function MemberHoverPreview({
  data,
  loading,
  error,
  style,
  onMouseEnter,
  onMouseLeave,
}: {
  data?: MemberPreview;
  loading: boolean;
  error: boolean;
  style: CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const name = data?.display_name || data?.first_name || data?.student_id;

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
        </div>
      )}
      {!loading && error && <p className="text-xs text-red-600">Could not load member info.</p>}
      {!loading && data && (
        <>
          <div className="flex items-start gap-2.5">
            <StudentAvatar photoUrl={data.photo_url} gender={data.gender} name={name ?? data.student_id} size="h-10 w-10" iconSize={20} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900">{name}</p>
              <p className="truncate font-mono text-xs text-slate-400">{data.student_id}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {data.cefr_level && (
                  <span className="badge bg-slate-100 text-[10px] text-slate-600">CEFR {data.cefr_level}</span>
                )}
                {data.cefr_status && (
                  <span className="badge bg-slate-100 text-[10px] text-slate-600">{data.cefr_status}</span>
                )}
                {data.looking_for_partner && (
                  <span className="badge bg-brand/10 text-[10px] text-brand">Seeking partner</span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
            <PreviewRow
              label="Age / Gender"
              value={[data.age != null ? String(data.age) : null, data.gender].filter(Boolean).join(' · ') || undefined}
            />
            <PreviewRow label="Friends" value={String(data.friends_count)} />
            <PreviewRow label="Communities" value={String(data.teams.length)} />
            {data.bio && <p className="line-clamp-3 text-xs leading-relaxed text-slate-600">{data.bio}</p>}
          </div>
        </>
      )}
    </div>
  );
}

/** Link to a community member profile — avatar, hover preview, opens in a new tab. */
export function CommunityMemberLink({
  studentId,
  name,
  photoUrl,
  gender,
  subtitle,
  avatarSize,
  iconSize,
  className = '',
}: {
  studentId: string;
  name?: string | null;
  photoUrl?: string | null;
  gender?: string | null;
  subtitle?: ReactNode;
  avatarSize?: string;
  iconSize?: number;
  className?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const showTimer = useRef<number>();
  const hideTimer = useRef<number>();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['member-profile-preview', studentId],
    queryFn: () => unwrap<MemberPreview>(api.get(`/community/members/${studentId}`)),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const updatePos = () => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cardH = 240;
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
        to={`/dashboard/community/member/${studentId}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`group -mx-1 inline-flex max-w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/80 ${className}`}
      >
        <StudentAvatar
          photoUrl={photoUrl}
          gender={gender}
          name={displayName}
          size={avatarSize}
          iconSize={iconSize}
        />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-slate-800 transition-colors group-hover:text-brand">
            {displayName}
          </span>
          {subtitleLine && (
            <span className="block truncate text-xs text-slate-400">{subtitleLine}</span>
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
          <MemberHoverPreview
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
