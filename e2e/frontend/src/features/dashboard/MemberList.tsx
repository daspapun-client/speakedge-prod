import { useQuery } from '@tanstack/react-query';
import { Crown, Loader2, UserMinus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AdminStudentLink, Modal } from '@/features/admin/_shared';

export interface MemberCard {
  student_id: string;
  display_name?: string | null;
  first_name?: string | null;
  photo_url?: string | null;
  cefr_level?: string | null;
  age?: number | null;
  gender?: string | null;
  bio?: string | null;
  is_owner?: boolean;
}

function memberLabel(m: MemberCard) {
  return m.display_name || m.first_name || m.student_id;
}

function RemoveMemberButton({
  label,
  pending,
  disabled,
  onClick,
  compact,
}: {
  label: string;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={`Remove ${label}`}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 font-medium text-red-600 transition hover:border-red-300 hover:bg-red-100 disabled:opacity-50 ${
        compact ? 'h-8 w-8 border-transparent bg-transparent px-0 hover:bg-red-50' : 'px-2.5 py-1.5 text-xs'
      }`}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
      {!compact && 'Remove'}
    </button>
  );
}
function MemberAvatar({ m, size = 'md', online }: { m: MemberCard; size?: 'sm' | 'md'; online?: boolean }) {
  const dim = size === 'sm' ? 'h-9 w-9 text-sm' : 'h-11 w-11 text-sm';
  return (
    <div className="relative shrink-0">
      {m.photo_url ? (
        <img
          src={m.photo_url}
          alt=""
          className={`${dim} rounded-full object-cover ring-2 ${online ? 'ring-emerald-200' : 'ring-white'}`}
        />
      ) : (
        <div
          className={`flex ${dim} items-center justify-center rounded-full font-bold ring-2 ${
            online ? 'bg-brand/15 text-brand ring-emerald-200' : 'bg-brand/10 text-brand ring-white'
          }`}
        >
          {memberLabel(m).charAt(0).toUpperCase()}
        </div>
      )}
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 shadow-sm" />
      )}
    </div>
  );
}

export function MemberList({
  members,
  onlineIds,
  variant = 'default',
  adminView,
  onRemove,
  removingId,
}: {
  members: MemberCard[];
  onlineIds?: Set<string>;
  variant?: 'default' | 'sidebar' | 'admin';
  adminView?: boolean;
  onRemove?: (member: MemberCard) => void;
  removingId?: string | null;
}) {
  const { subject } = useAuth();
  const showAdmin = adminView || variant === 'admin';

  if (variant === 'admin') {
    return (
      <div className="divide-y divide-slate-100">
        {members.map((m) => (
          <div key={m.student_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <AdminStudentLink
              studentId={m.student_id}
              name={memberLabel(m)}
              photoUrl={m.photo_url}
              gender={m.gender}
              avatarSize="h-9 w-9"
              iconSize={16}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-xs text-slate-500">
                {m.is_owner && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                    <Crown size={11} /> Owner
                  </span>
                )}
                {m.cefr_level && <span>CEFR {m.cefr_level}</span>}
              </div>
            </div>
            {onRemove && (
              <RemoveMemberButton
                label={memberLabel(m)}
                pending={removingId === m.student_id}
                disabled={Boolean(removingId)}
                onClick={() => onRemove(m)}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'sidebar') {
    const sorted = [...members].sort((a, b) => {
      const ao = onlineIds?.has(a.student_id) ? 0 : 1;
      const bo = onlineIds?.has(b.student_id) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return memberLabel(a).localeCompare(memberLabel(b));
    });

    return (
      <div className="space-y-0.5">
        {sorted.map((m) => {
          const online = onlineIds?.has(m.student_id);
          const isMe = m.student_id === subject;
          const row = (
            <>
              <MemberAvatar m={m} size="sm" online={online} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-800">
                  <span className="truncate">{memberLabel(m)}</span>
                  {m.is_owner && <Crown size={12} className="shrink-0 text-brand-gold" />}
                  {!showAdmin && isMe && (
                    <span className="shrink-0 rounded-full bg-brand/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-brand">
                      You
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  {m.cefr_level ? (
                    <span className="rounded-md bg-white px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200/80">
                      CEFR {m.cefr_level}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">Learner</span>
                  )}
                  {online && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Online
                    </span>
                  )}
                </div>
              </div>
            </>
          );
          return (
            <div
              key={m.student_id}
              className={`flex items-center gap-1 rounded-xl px-2 py-2 transition hover:bg-white hover:shadow-sm ${
                isMe ? 'bg-brand/[0.06] ring-1 ring-brand/15' : online ? 'bg-white/60' : ''
              }`}
            >
              {showAdmin ? (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <AdminStudentLink
                    studentId={m.student_id}
                    name={memberLabel(m)}
                    photoUrl={m.photo_url}
                    gender={m.gender}
                    avatarSize="h-9 w-9"
                    iconSize={16}
                    className="min-w-0 flex-1 py-0"
                  />
                </div>
              ) : (
                <Link to={`/dashboard/community/member/${m.student_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  {row}
                </Link>
              )}
              {onRemove && (
                <RemoveMemberButton
                  label={memberLabel(m)}
                  pending={removingId === m.student_id}
                  disabled={Boolean(removingId)}
                  onClick={() => onRemove(m)}
                  compact
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {members.map((m) => (
        <div key={m.student_id} className="flex items-center gap-3">
          <MemberAvatar m={m} online={onlineIds?.has(m.student_id)} />
          <div className="min-w-0">
            <div className="flex items-center gap-1 font-semibold">
              <Link to={`/dashboard/community/member/${m.student_id}`} className="hover:text-brand hover:underline">
                {memberLabel(m)}
              </Link>
              {m.is_owner && <Crown size={14} className="text-brand-gold" />}
              {m.student_id === subject && <span className="text-xs font-normal text-slate-400">(you)</span>}
            </div>
            <div className="text-xs text-slate-400">
              {[m.cefr_level ? `CEFR ${m.cefr_level}` : null, m.age ? `${m.age}y` : null, m.gender].filter(Boolean).join(' · ') || '—'}
            </div>
            {m.bio && <div className="truncate text-xs text-slate-500">{m.bio}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Fetches a team's roster on demand and shows it in a modal. */
export function TeamMembersModal({
  teamId,
  teamName,
  maxMembers,
  onClose,
  adminView,
  onRemove,
  removingId,
}: {
  teamId: string;
  teamName?: string;
  maxMembers?: number;
  onClose: () => void;
  adminView?: boolean;
  onRemove?: (member: MemberCard) => void;
  removingId?: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => unwrap<{ members: MemberCard[] }>(api.get(`/community/teams/${teamId}/members`)),
  });
  const count = data?.members.length ?? 0;
  return (
    <Modal onClose={onClose}>
      <div className="mb-4">
        <h3 className="font-bold text-slate-900">{teamName ?? 'Community class members'}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {count}{maxMembers ? ` / ${maxMembers}` : ''} members
          {adminView && onRemove ? ' · click remove to take someone out of this community class' : ''}
        </p>
      </div>
      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {data && (
        <MemberList
          members={data.members}
          variant={adminView ? 'admin' : 'default'}
          adminView={adminView}
          onRemove={onRemove}
          removingId={removingId}
        />
      )}
    </Modal>
  );
}
