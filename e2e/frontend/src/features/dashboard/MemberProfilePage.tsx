import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, UserPlus, Flag, Users, Heart, CheckCircle2, Clock, Crown, Loader2,
  MessageCircle, Ban, UserX, MoreHorizontal, GraduationCap, User, Sparkles,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { StudentAvatar } from '@/features/admin/_shared';

interface MemberProfile {
  student_id: string;
  display_name?: string | null;
  first_name?: string | null;
  age?: number | null;
  gender?: string | null;
  photo_url?: string | null;
  cefr_level?: string | null;
  cefr_status?: string | null;
  bio?: string | null;
  interests?: string[];
  looking_for_partner?: boolean;
  friends_count: number;
  relationship: 'self' | 'friends' | 'request_sent' | 'request_received' | 'blocked' | 'none';
  can_message: boolean;
  teams: { id: string; name: string; members: number; is_owner: boolean }[];
}

type ProfileTab = 'about' | 'communities';

function fbBtnPrimary(extra = '') {
  return `inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-light disabled:opacity-60 sm:min-h-0 md:flex-none md:px-4 ${extra}`;
}

function fbBtnSecondary(extra = '') {
  return `inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-300 disabled:opacity-60 sm:min-h-0 md:flex-none md:px-4 ${extra}`;
}

function IntroRow({ icon: Icon, children }: { icon: typeof User; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-[15px] text-slate-800">
      <Icon size={20} className="mt-0.5 shrink-0 text-slate-500" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="-mx-3 -mt-4 animate-pulse sm:-mx-4 sm:-mt-6 md:-mx-4 md:-mt-8">
      <section className="border-b border-slate-200 bg-white">
        <div className="h-[11.5rem] bg-gradient-to-br from-brand via-brand-light to-indigo-600 sm:h-48 md:h-52" />
        <div className="relative z-10 mx-auto max-w-5xl px-4 pb-4">
          <div className="grid grid-cols-[auto_1fr] items-end gap-x-3">
            <div className="relative -mt-14 h-[7.5rem] w-[7.5rem] rounded-full bg-slate-200 ring-4 ring-white sm:-mt-16 sm:h-32 sm:w-32 md:-mt-20 md:h-40 md:w-40" />
            <div className="space-y-2 pb-1 pt-8">
              <div className="h-7 w-40 rounded bg-slate-200 sm:h-8 sm:w-48" />
              <div className="h-4 w-24 rounded bg-slate-100" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <div className="h-9 flex-1 rounded-lg bg-slate-200" />
            <div className="h-9 w-11 shrink-0 rounded-lg bg-slate-100" />
          </div>
        </div>
      </section>
    </div>
  );
}

function ProfileTabs({ tab, onTab, friendsCount, communitiesCount }: {
  tab: ProfileTab;
  onTab: (t: ProfileTab) => void;
  friendsCount: number;
  communitiesCount: number;
}) {
  const items: { id: ProfileTab; label: string }[] = [
    { id: 'about', label: 'About' },
    { id: 'communities', label: `Communities${communitiesCount ? ` · ${communitiesCount}` : ''}` },
  ];

  return (
    <div className="overflow-x-auto border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl gap-1 px-2 md:px-4">
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            className={`-mb-px shrink-0 border-b-[3px] px-3 py-3 text-[15px] font-semibold transition md:px-4 ${
              tab === t.id
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="-mb-px shrink-0 border-b-[3px] border-transparent px-3 py-3 text-[15px] font-semibold text-slate-400 md:px-4">
          {friendsCount} {friendsCount === 1 ? 'friend' : 'friends'}
        </span>
      </div>
    </div>
  );
}

function ActionButtons({
  data,
  isSelf,
  addFriend,
  block,
  unblock,
  report,
  moreOpen,
  setMoreOpen,
}: {
  data: MemberProfile;
  isSelf: boolean;
  addFriend: ReturnType<typeof useMutation<unknown, Error, void>>;
  block: ReturnType<typeof useMutation<unknown, Error, void>>;
  unblock: ReturnType<typeof useMutation<unknown, Error, void>>;
  report: ReturnType<typeof useMutation<unknown, Error, void>>;
  moreOpen: boolean;
  setMoreOpen: (v: boolean) => void;
}) {
  if (isSelf) {
    return (
      <div className="flex w-full items-stretch gap-2">
        <Link to="/dashboard/profile" className={fbBtnPrimary('md:min-w-[8rem]')}>
          <User size={16} /> Edit profile
        </Link>
      </div>
    );
  }

  if (data.relationship === 'blocked') {
    return (
      <div className="flex w-full items-stretch gap-2">
        <button
          type="button"
          className={fbBtnPrimary('md:min-w-[8rem]')}
          disabled={unblock.isPending}
          onClick={() => unblock.mutate()}
        >
          {unblock.isPending ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
          Unblock
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full items-stretch gap-2">
      {data.relationship === 'friends' ? (
        <>
          <Link to={`/dashboard/community/chat/${data.student_id}`} className={fbBtnPrimary('md:min-w-[8rem]')}>
            <MessageCircle size={16} /> Message
          </Link>
          <span className={fbBtnSecondary('pointer-events-none md:min-w-[7rem]')}>
            <CheckCircle2 size={16} /> Friends
          </span>
        </>
      ) : data.relationship === 'request_sent' ? (
        <span className={fbBtnSecondary('pointer-events-none md:min-w-[10rem]')}>
          <Clock size={16} /> Request sent
        </span>
      ) : data.relationship === 'request_received' ? (
        <Link to="/dashboard/community/friends" className={fbBtnPrimary('md:min-w-[10rem]')}>
          <Heart size={16} /> Respond to request
        </Link>
      ) : (
        <button
          type="button"
          className={fbBtnPrimary('md:min-w-[8rem]')}
          disabled={addFriend.isPending || addFriend.isSuccess}
          onClick={() => addFriend.mutate()}
        >
          {addFriend.isPending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          {addFriend.isSuccess ? 'Request sent' : 'Add friend'}
        </button>
      )}

      <div className="relative shrink-0">
        <button
          type="button"
          className="inline-flex h-full min-h-9 w-11 items-center justify-center rounded-lg bg-slate-200 text-slate-800 transition hover:bg-slate-300 md:min-h-0"
          onClick={() => setMoreOpen(!moreOpen)}
          aria-label="More actions"
        >
          <MoreHorizontal size={18} />
        </button>
        {moreOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-10"
              aria-label="Close menu"
              onClick={() => setMoreOpen(false)}
            />
            <div className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                disabled={block.isPending}
                onClick={() => { block.mutate(); setMoreOpen(false); }}
              >
                {block.isPending ? <Loader2 size={16} className="animate-spin" /> : <UserX size={16} />}
                Block
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                disabled={report.isPending || report.isSuccess}
                onClick={() => { report.mutate(); setMoreOpen(false); }}
              >
                <Flag size={16} />
                {report.isSuccess ? 'Reported' : 'Report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MemberProfilePage() {
  const { studentId = '' } = useParams();
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/dashboard/community');
  };
  const qc = useQueryClient();
  const [tab, setTab] = useState<ProfileTab>('about');
  const [moreOpen, setMoreOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['member-profile', studentId],
    queryFn: () => unwrap<MemberProfile>(api.get(`/community/members/${studentId}`)),
    retry: false,
  });

  const addFriend = useMutation({
    mutationFn: () => unwrap(api.post('/community/friend-request', { to_student_id: studentId })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['member-profile', studentId] }),
  });
  const report = useMutation({
    mutationFn: () =>
      unwrap(api.post('/community/report', { against_student_id: studentId, reason: 'Reported from member profile' })),
  });
  const invalidateProfile = () => {
    qc.invalidateQueries({ queryKey: ['member-profile', studentId] });
    qc.invalidateQueries({ queryKey: ['friends'] });
    qc.invalidateQueries({ queryKey: ['blocked'] });
    qc.invalidateQueries({ queryKey: ['friend-requests'] });
  };
  const block = useMutation({
    mutationFn: () => unwrap(api.post('/community/block', { student_id: studentId })),
    onSuccess: invalidateProfile,
  });
  const unblock = useMutation({
    mutationFn: () => unwrap(api.post('/community/unblock', { student_id: studentId })),
    onSuccess: invalidateProfile,
  });

  if (isLoading) return <ProfileSkeleton />;

  if (error || !data) {
    return (
      <div className="card">
        <p className="text-slate-500">This member profile isn't available.</p>
        <button type="button" className="btn-ghost mt-4 inline-flex" onClick={goBack}>
          Go back
        </button>
      </div>
    );
  }

  const name = data.display_name || data.first_name || data.student_id;
  const isSelf = data.relationship === 'self';
  const cefrLabel = data.cefr_level ? `CEFR ${data.cefr_level}` : 'CEFR level not set';
  const metaParts = [
    data.gender,
    data.age != null ? `${data.age} years old` : null,
  ].filter(Boolean);

  return (
    <div className="-mx-3 -mt-4 sm:-mx-4 sm:-mt-6 md:-mx-4 md:-mt-8">
      <section className="isolate border-b border-slate-200 bg-white">
        {/* Cover photo */}
        <div className="relative z-0 h-[11.5rem] overflow-hidden bg-gradient-to-br from-brand via-brand-light to-indigo-600 sm:h-48 md:h-52">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_15%,rgba(244,180,0,0.45),transparent_50%)]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_10%_90%,rgba(56,189,248,0.35),transparent_55%)]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-brand/60 via-transparent to-white/10"
            aria-hidden
          />
          <button
            type="button"
            onClick={goBack}
            className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-sm font-semibold text-white shadow-sm backdrop-blur-md transition hover:bg-white/25 md:left-4 md:top-4"
          >
            <ArrowLeft size={16} /> Back
          </button>
        </div>

        {/* Profile header — z-10 so it paints above the cover overlap zone */}
        <div className="relative z-10 mx-auto max-w-5xl px-4 pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
            <div className="grid min-w-0 flex-1 grid-cols-[auto_1fr] items-end gap-x-3 sm:gap-4">
              <div className="relative z-20 -mt-14 shrink-0 sm:-mt-16 md:-mt-20">
                <div className="overflow-hidden rounded-full shadow-md ring-4 ring-white">
                  <StudentAvatar
                    photoUrl={data.photo_url}
                    gender={data.gender}
                    name={name}
                    size="h-[7.5rem] w-[7.5rem] sm:h-32 sm:w-32 md:h-40 md:w-40"
                    iconSize={40}
                  />
                </div>
              </div>
              <div className="relative z-20 min-w-0 pb-1 pt-8 sm:pt-10 md:pb-2 md:pt-12">
                <h1 className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl md:text-[32px]">{name}</h1>
                <p className="mt-0.5 text-sm font-semibold text-brand sm:text-[15px]">
                  {data.friends_count} {data.friends_count === 1 ? 'friend' : 'friends'}
                </p>
                {!!metaParts.length && (
                  <p className="mt-0.5 text-sm text-slate-500 sm:text-[15px]">{metaParts.join(' · ')}</p>
                )}
              </div>
            </div>

            <div className="relative z-20 w-full shrink-0 md:w-auto md:max-w-md">
              <ActionButtons
                data={data}
                isSelf={isSelf}
                addFriend={addFriend}
                block={block}
                unblock={unblock}
                report={report}
                moreOpen={moreOpen}
                setMoreOpen={setMoreOpen}
              />
            </div>
          </div>

          {(addFriend.isError || block.isError) && (
            <p className="mt-3 text-sm text-amber-600">
              {(addFriend.error as Error)?.message || (block.error as Error)?.message}
            </p>
          )}
          {report.isSuccess && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 size={16} /> Report submitted for review.
            </div>
          )}
        </div>

        <ProfileTabs
          tab={tab}
          onTab={setTab}
          friendsCount={data.friends_count}
          communitiesCount={data.teams.length}
        />
      </section>

      {/* Tab content */}
      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
        {tab === 'about' ? (
          <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
            <section className="h-fit rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">Intro</h2>
              <div className="mt-4 space-y-3">
                <IntroRow icon={GraduationCap}>
                  {cefrLabel}
                  {data.cefr_status && (
                    <span className="text-slate-500"> — {data.cefr_status}</span>
                  )}
                </IntroRow>
                {data.gender && <IntroRow icon={User}>{data.gender}</IntroRow>}
                {data.age != null && <IntroRow icon={User}>{data.age} years old</IntroRow>}
                {data.looking_for_partner && (
                  <IntroRow icon={Heart}>Looking for a conversation partner</IntroRow>
                )}
                <IntroRow icon={Users}>
                  Member of {data.teams.length} {data.teams.length === 1 ? 'community' : 'communities'}
                </IntroRow>
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-xl font-bold text-slate-900">About</h2>
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
                  {data.bio || "This member hasn't added a bio yet."}
                </p>
              </section>

              {!!data.interests?.length && (
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-xl font-bold text-slate-900">Interests</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {data.interests.map((i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700"
                      >
                        <Sparkles size={14} className="text-slate-400" />
                        {i}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        ) : (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-slate-900">Communities</h2>
              <span className="text-sm text-slate-500">{data.teams.length} total</span>
            </div>
            {data.teams.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {data.teams.map((t) => (
                  <Link
                    key={t.id}
                    to={`/dashboard/community/${t.id}`}
                    className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3 transition hover:border-brand/30 hover:bg-brand/5"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <Users size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{t.name}</p>
                      <p className="text-sm text-slate-500">
                        {t.members} {t.members === 1 ? 'member' : 'members'}
                        {t.is_owner && ' · Admin'}
                      </p>
                    </div>
                    {t.is_owner && <Crown size={16} className="shrink-0 text-brand" />}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-[15px] text-slate-500">Not part of any community yet.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
