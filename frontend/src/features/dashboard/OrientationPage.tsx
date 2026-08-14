import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CheckCircle2, GraduationCap, PartyPopper, PlayCircle, Users, Video, X,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { fmtDate } from '@/features/admin/_shared';

interface Step {
  key: string;
  title: string;
  body: string;
  points?: string[];
  requires_accept?: boolean;
}

interface BatchInfo {
  id: string;
  title: string;
  mode: 'live' | 'recorded';
  scheduled_at?: string | null;
  duration_min: number;
  meeting_url?: string | null;
  recording_url?: string | null;
  agenda?: string[];
  teacher_name?: string | null;
  status: string;
}

interface OpenBatch {
  id: string;
  title: string;
  mode: 'live' | 'recorded';
  scheduled_at?: string | null;
  duration_min: number;
  teacher_name?: string | null;
  agenda?: string[];
}

interface OrientationView {
  status: 'pending' | 'in_progress' | 'completed';
  step: number;
  completed_at?: string | null;
  total_steps: number;
  steps: Step[];
  batch?: BatchInfo | null;
  can_self_complete: boolean;
  open_batches: OpenBatch[];
}

interface TutorialVideo {
  id: string;
  title: string;
  source: string;
  url: string;
  description?: string | null;
}

function youtubeId(url: string) {
  return url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/)([\w-]{11})/)?.[1] ?? null;
}

function CompletedScreen({ view }: { view: OrientationView }) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="card border-green-200 bg-gradient-to-b from-green-50 to-white p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
          <PartyPopper size={32} />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold text-slate-900">Congratulations!</h1>
        <p className="mt-2 text-slate-600">
          You have successfully completed the SpeakEdge New Student Orientation. You are now
          ready to begin your learning journey.
        </p>
        {view.completed_at && (
          <p className="mt-2 text-xs text-slate-400">Completed {fmtDate(view.completed_at)}</p>
        )}
        <Link to="/dashboard" className="btn-primary mt-6 inline-flex">Go to Dashboard</Link>
      </div>
    </div>
  );
}

function SessionCard({ batch }: { batch: BatchInfo }) {
  const isLive = batch.mode === 'live';
  return (
    <div className="card border-brand/20 bg-brand/5">
      <div className="flex items-center gap-2 text-sm font-bold text-brand">
        {isLive ? <Video size={16} /> : <PlayCircle size={16} />}
        {isLive ? 'Live orientation session' : 'Recorded orientation'}
      </div>
      <p className="mt-2 text-sm text-slate-700">
        <span className="font-semibold">{batch.title}</span>
        {batch.teacher_name && <> · with {batch.teacher_name}</>}
      </p>
      <div className="mt-1 text-xs text-slate-500">
        {isLive && batch.scheduled_at ? `Scheduled ${fmtDate(batch.scheduled_at)} · ` : ''}
        {batch.duration_min} min
      </div>
      {isLive ? (
        batch.meeting_url ? (
          <a href={batch.meeting_url} target="_blank" rel="noreferrer" className="btn-primary mt-3 inline-flex py-1.5 text-sm">
            Join session
          </a>
        ) : (
          <p className="mt-3 text-xs text-slate-500">Your teacher will share the join link before the session.</p>
        )
      ) : batch.recording_url ? (
        <a href={batch.recording_url} target="_blank" rel="noreferrer" className="btn-primary mt-3 inline-flex py-1.5 text-sm">
          Watch orientation video
        </a>
      ) : null}
      {isLive && (
        <p className="mt-3 text-xs text-slate-500">
          Your teacher marks your orientation complete during this session.
        </p>
      )}
    </div>
  );
}

function JoinBatches({
  batches, onJoin, joining, error,
}: {
  batches: OpenBatch[];
  onJoin: (id: string) => void;
  joining: string | null;
  error: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-sm font-bold text-brand">
        <Users size={16} /> Join an orientation class
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Pick one class to attend — you can join a single orientation class.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {batches.length ? (
        <ul className="mt-3 space-y-2">
          {batches.map((b) => {
            const isLive = b.mode === 'live';
            return (
              <li key={b.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isLive ? 'bg-brand/10 text-brand' : 'bg-violet-100 text-violet-600'}`}>
                  {isLive ? <Video size={16} /> : <PlayCircle size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{b.title}</p>
                  <p className="text-xs text-slate-500">
                    {isLive ? 'Live session' : 'Recorded (self-paced)'}
                    {b.teacher_name && <> · {b.teacher_name}</>}
                    {isLive && b.scheduled_at ? <> · {fmtDate(b.scheduled_at)}</> : null}
                    {' · '}{b.duration_min} min
                  </p>
                </div>
                <button
                  className="btn-primary shrink-0 py-1.5 text-sm disabled:opacity-50"
                  disabled={joining !== null}
                  onClick={() => onJoin(b.id)}
                >
                  {joining === b.id ? 'Joining…' : 'Join'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          No orientation classes are open right now. Please check back soon — you'll be notified when one is scheduled.
        </p>
      )}
    </div>
  );
}

function TutorialVideos() {
  const [playing, setPlaying] = useState<TutorialVideo | null>(null);
  const { data } = useQuery({
    queryKey: ['orientation-tutorials'],
    queryFn: () => unwrap<TutorialVideo[]>(api.get('/videos/', { params: { category: 'orientation' } })),
  });
  const videos = data ?? [];
  if (!videos.length) return null;

  return (
    <div className="card">
      <div className="flex items-center gap-2 text-sm font-bold text-brand">
        <PlayCircle size={16} /> Orientation tutorials
      </div>
      <p className="mt-1 text-xs text-slate-500">Short videos to help you get started on SpeakEdge.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {videos.map((v) => {
          const ytId = v.source === 'youtube' ? youtubeId(v.url) : null;
          const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setPlaying(v)}
              className="group overflow-hidden rounded-xl border border-slate-200 text-left transition hover:border-brand/40 hover:shadow-sm"
            >
              <div className="relative aspect-video bg-slate-900">
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-white/30"><Video size={30} /></div>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <PlayCircle size={34} className="text-white/90 drop-shadow transition group-hover:scale-110" />
                </span>
              </div>
              <div className="p-2.5">
                <p className="truncate text-sm font-semibold text-slate-800">{v.title}</p>
                {v.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{v.description}</p>}
              </div>
            </button>
          );
        })}
      </div>

      {playing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setPlaying(null)}>
          <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="truncate font-bold text-slate-800">{playing.title}</h3>
              <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => setPlaying(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="bg-black">
              {youtubeId(playing.url) ? (
                <iframe
                  className="aspect-video w-full"
                  src={`https://www.youtube.com/embed/${youtubeId(playing.url)}?autoplay=1&rel=0`}
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                  title={playing.title}
                />
              ) : (
                <video className="aspect-video w-full" src={playing.url} controls autoPlay />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function OrientationPage() {
  const qc = useQueryClient();
  const [idx, setIdx] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['orientation'],
    queryFn: () => unwrap<OrientationView>(api.get('/orientation/me')),
  });

  // Resume where the student left off.
  useEffect(() => {
    if (data) setIdx((cur) => (cur === 0 ? Math.min(data.step, data.steps.length - 1) : cur));
  }, [data]);

  const saveProgress = useMutation({
    mutationFn: (step: number) => unwrap(api.post('/orientation/me/progress', { step })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orientation'] }),
  });

  const complete = useMutation({
    mutationFn: () => unwrap(api.post('/orientation/me/complete', { rules_accepted: accepted })),
    onSuccess: () => {
      setError('');
      qc.invalidateQueries({ queryKey: ['orientation'] });
      qc.invalidateQueries({ queryKey: ['orientation-status'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const [joinError, setJoinError] = useState('');
  const join = useMutation({
    mutationFn: (batchId: string) => unwrap(api.post('/orientation/me/join', { batch_id: batchId })),
    onSuccess: () => {
      setJoinError('');
      qc.invalidateQueries({ queryKey: ['orientation'] });
      qc.invalidateQueries({ queryKey: ['orientation-status'] });
    },
    onError: (e: Error) => setJoinError(e.message),
  });

  if (isLoading || !data) {
    return <div className="mx-auto max-w-2xl animate-pulse space-y-4"><div className="h-6 w-40 rounded bg-slate-200" /><div className="h-64 rounded-xl bg-slate-200" /></div>;
  }

  if (data.status === 'completed') return <CompletedScreen view={data} />;

  const steps = data.steps;
  const step = steps[idx];
  const isLast = idx === steps.length - 1;
  const progress = Math.round(((idx + 1) / steps.length) * 100);

  const goNext = () => {
    const next = Math.min(idx + 1, steps.length - 1);
    setIdx(next);
    saveProgress.mutate(next + 1);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <div className="flex items-center gap-2 text-brand">
          <GraduationCap size={20} />
          <h1 className="text-xl font-extrabold text-slate-900 sm:text-2xl">New Student Orientation</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          A quick tour of SpeakEdge — about 30–60 minutes. Complete it to start your learning journey.
        </p>
      </div>

      {data.batch ? (
        <SessionCard batch={data.batch} />
      ) : (
        <JoinBatches
          batches={data.open_batches ?? []}
          onJoin={(id) => join.mutate(id)}
          joining={join.isPending ? (join.variables ?? null) : null}
          error={joinError}
        />
      )}

      {/* Progress */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
          <span>Step {idx + 1} of {steps.length}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Step card */}
      <div className="card">
        <h2 className="text-lg font-bold text-slate-900">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
        {!!step.points?.length && (
          <ul className="mt-4 space-y-2.5">
            {step.points.map((p) => (
              <li key={p} className="flex gap-2.5 text-sm text-slate-700">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-brand" />
                <span className="leading-snug">{p}</span>
              </li>
            ))}
          </ul>
        )}

        {step.requires_accept && (
          <label className="mt-5 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>I have read and accept the rules & guidelines above.</span>
          </label>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            className="btn-ghost py-2 text-sm disabled:opacity-40"
            disabled={idx === 0}
            onClick={() => setIdx(Math.max(0, idx - 1))}
          >
            <ArrowLeft size={15} /> Back
          </button>

          {!isLast ? (
            <button className="btn-primary py-2 text-sm" onClick={goNext}>
              Next <ArrowRight size={15} />
            </button>
          ) : data.can_self_complete ? (
            <button
              className="btn-gold py-2 text-sm"
              disabled={(step.requires_accept && !accepted) || complete.isPending}
              onClick={() => complete.mutate()}
            >
              Complete orientation <CheckCircle2 size={15} />
            </button>
          ) : (
            <span className="text-right text-xs text-slate-500">
              Your teacher will mark your orientation complete during the live session.
            </span>
          )}
        </div>
      </div>

      <TutorialVideos />
    </div>
  );
}
