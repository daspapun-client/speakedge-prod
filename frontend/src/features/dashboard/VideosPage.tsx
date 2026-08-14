import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CheckCircle, ChevronLeft, History, PlayCircle, X, Video, FolderOpen, Clock, Sparkles, type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, fmtDay } from '@/features/admin/_shared';

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: Record<string, unknown>,
      ) => unknown;
      PlayerState: { ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function youtubeId(url: string) {
  return url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/)([\w-]{11})/)?.[1] ?? null;
}

function videoThumbnail(v: VideoItem) {
  if (v.source !== 'youtube') return null;
  const id = youtubeId(v.url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

function fmtDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function fmtRelative(iso?: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return fmtDay(iso);
}

interface WatchPayload {
  last_position_s?: number;
  completed?: boolean;
  session_start?: boolean;
  flush?: boolean;
}

interface VideoItem {
  id: string;
  title: string;
  category: string;
  source: string;
  url: string;
  access: string;
  plans?: string[];
  description?: string | null;
}

interface Plan { plan: string; label: string }

function videoSection(v: VideoItem, labels: Map<string, string>): string {
  if (!v.plans?.length) return 'General';
  if (v.plans.length === 1) return labels.get(v.plans[0]) ?? v.plans[0];
  return 'Private';
}

interface WatchItem {
  id: string;
  video_id: string;
  watched_at?: string | null;
  created_at: string;
  last_position_s?: number | null;
  completed?: boolean | null;
  view_count?: number;
}

function watchSummary(stats?: WatchItem) {
  if (!stats) return null;
  const parts: string[] = [];
  const views = stats.view_count ?? 1;
  if (views > 1) parts.push(`${views} views`);
  if (stats.completed) parts.push('Completed');
  else if (stats.last_position_s && stats.last_position_s > 0) {
    parts.push(`Stopped at ${fmtDuration(stats.last_position_s)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

type YtPlayer = {
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
};

function Thumbnail({
  v,
  stats,
  className = '',
  rounded = 'rounded-xl',
}: {
  v: VideoItem;
  stats?: WatchItem;
  className?: string;
  rounded?: string;
}) {
  const thumb = videoThumbnail(v);
  const completed = !!stats?.completed;
  const resumeAt = stats?.last_position_s ?? 0;
  const inProgress = !!stats && !completed && resumeAt > 0;

  return (
    <div className={`relative aspect-video overflow-hidden bg-slate-900 ${rounded} ${className}`}>
      {thumb ? (
        <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950">
          <Video className="text-white/30" size={28} />
        </div>
      )}
      {inProgress && (
        <span className="absolute bottom-1.5 right-1.5 rounded px-1 py-0.5 text-[11px] font-semibold text-white bg-black/80">
          {fmtDuration(resumeAt)}
        </span>
      )}
      {completed && (
        <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold text-white bg-black/80">
          <CheckCircle size={10} /> Watched
        </span>
      )}
    </div>
  );
}

function Player({
  v,
  section,
  startAt,
  onClose,
  onProgress,
}: {
  v: VideoItem;
  section: string;
  startAt: number;
  onClose: () => void;
  onProgress: (payload: WatchPayload) => void;
}) {
  const ytId = v.source === 'youtube' ? youtubeId(v.url) : null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YtPlayer | null>(null);
  const lastSaveRef = useRef(0);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  const saveProgress = useCallback((position: number, extra?: Omit<WatchPayload, 'last_position_s'>) => {
    const pos = Math.max(0, Math.floor(position));
    const now = Date.now();
    if (!extra?.flush && !extra?.completed && !extra?.session_start && now - lastSaveRef.current < 10000) return;
    lastSaveRef.current = now;
    onProgressRef.current({ last_position_s: pos, ...extra });
  }, []);

  useEffect(() => {
    onProgressRef.current({ last_position_s: startAt, session_start: true });
  // ponytail: session ping once per player open
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ytId) return;
    const el = videoRef.current;
    if (!el) return;

    const onMeta = () => {
      if (startAt > 0) el.currentTime = startAt;
    };
    const onTime = () => saveProgress(el.currentTime);
    const onEnd = () => saveProgress(el.duration || el.currentTime, { completed: true, flush: true });

    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    if (el.readyState >= 1) onMeta();

    return () => {
      if (el.currentTime > 0) saveProgress(el.currentTime, { flush: true });
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
    };
  }, [ytId, startAt, saveProgress]);

  useEffect(() => {
    if (!ytId || !ytHostRef.current) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    let destroyed = false;

    const mountPlayer = () => {
      if (destroyed || !ytHostRef.current || !window.YT?.Player) return;
      ytPlayerRef.current = new window.YT.Player(ytHostRef.current, {
        videoId: ytId,
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, start: startAt || 0 },
        events: {
          onReady: (event: { target: YtPlayer }) => {
            interval = setInterval(() => {
              try {
                saveProgress(event.target.getCurrentTime());
              } catch { /* player torn down */ }
            }, 10000);
          },
          onStateChange: (event: { data: number; target: YtPlayer }) => {
            if (event.data === window.YT!.PlayerState.ENDED) {
              saveProgress(event.target.getDuration(), { completed: true, flush: true });
            }
          },
        },
      }) as YtPlayer;
    };

    if (window.YT?.Player) mountPlayer();
    else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        mountPlayer();
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(script);
      }
    }

    return () => {
      destroyed = true;
      if (interval) clearInterval(interval);
      const player = ytPlayerRef.current;
      if (player) {
        try {
          const t = player.getCurrentTime();
          if (t > 0) saveProgress(t, { flush: true });
          player.destroy();
        } catch { /* ignore */ }
        ytPlayerRef.current = null;
      }
    };
  }, [ytId, startAt, saveProgress]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-white md:items-center md:justify-center md:bg-black/60 md:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden md:h-auto md:max-h-[90vh] md:max-w-3xl md:rounded-xl md:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative shrink-0 bg-black">
          <button
            type="button"
            className="absolute left-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition active:scale-95 md:hidden"
            onClick={onClose}
            aria-label="Back"
          >
            <ChevronLeft size={22} />
          </button>
          {ytId ? (
            <div ref={ytHostRef} className="aspect-video w-full" />
          ) : (
            <video ref={videoRef} className="aspect-video w-full" src={v.url} controls autoPlay />
          )}
        </div>

        <div className="hidden items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 md:flex">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{section}</p>
            <h2 className="font-bold text-slate-800">{v.title}</h2>
            {startAt > 0 && (
              <p className="mt-1 text-xs text-brand">Resuming from {fmtDuration(startAt)}</p>
            )}
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="Close player"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 md:border-t md:border-slate-100 md:px-5 md:py-4">
          <div className="md:hidden">
            <h1 className="text-base font-semibold leading-snug text-slate-900">{v.title}</h1>
            <p className="mt-1.5 text-sm text-slate-500">{section}</p>
            {startAt > 0 && (
              <p className="mt-1 text-xs font-medium text-brand">Resuming from {fmtDuration(startAt)}</p>
            )}
          </div>
          {v.description && (
            <p className="mt-3 text-sm leading-relaxed text-slate-600 md:mt-0">{v.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, icon: Icon, hint }: { label: string; value: number | string; icon: LucideIcon; hint?: string }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-extrabold text-brand">{value}</div>
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
  count,
  children,
}: {
  title: string;
  icon: LucideIcon;
  description?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-brand/10 p-2 text-brand">
            <Icon size={18} />
          </span>
          <div>
            <h2 className="font-bold capitalize text-slate-800">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        {count != null && (
          <span className="text-sm text-slate-400">{count} video{count === 1 ? '' : 's'}</span>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function VideoRow({
  v,
  section,
  onPlay,
  stats,
}: {
  v: VideoItem;
  section: string;
  onPlay: () => void;
  stats?: WatchItem;
}) {
  const completed = !!stats?.completed;
  const resumeAt = stats?.last_position_s ?? 0;
  const inProgress = !!stats && !completed && resumeAt > 0;
  const views = stats?.view_count ?? 0;
  const lastWatched = stats?.watched_at || stats?.created_at;
  const meta: string[] = [];
  if (completed) meta.push('Watched');
  else if (inProgress) meta.push(`Resume · ${fmtDuration(resumeAt)}`);
  if (views > 1) meta.push(`${views} views`);
  if (lastWatched && stats) meta.push(fmtRelative(lastWatched) ?? fmtDay(lastWatched));

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Watch ${v.title}`}
      className="flex w-full gap-3 px-3 py-2.5 text-left transition active:bg-slate-100"
    >
      <Thumbnail v={v} stats={stats} className="w-[168px] shrink-0" />
      <div className="min-w-0 flex-1 py-0.5">
        <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-slate-900">{v.title}</h3>
        <p className="mt-1.5 line-clamp-1 text-xs text-slate-500">{section}</p>
        {meta.length > 0 && (
          <p className="mt-1 line-clamp-1 text-xs text-slate-500">{meta.join(' · ')}</p>
        )}
      </div>
    </button>
  );
}

function VideoCard({ v, section, onPlay, stats }: { v: VideoItem; section: string; onPlay: () => void; stats?: WatchItem }) {
  const thumb = videoThumbnail(v);
  const completed = !!stats?.completed;
  const resumeAt = stats?.last_position_s ?? 0;
  const inProgress = !!stats && !completed && resumeAt > 0;
  const views = stats?.view_count ?? 0;
  const lastWatched = stats?.watched_at || stats?.created_at;

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Watch ${v.title}`}
      className="group overflow-hidden rounded-2xl border border-slate-200/80 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-lg"
    >
      <div className="relative aspect-video overflow-hidden bg-slate-900">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950">
            <Video className="text-white/30" size={36} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
          {v.source === 'youtube' ? 'YouTube' : 'Uploaded'}
        </span>
        {completed && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-green-600/90 px-2 py-0.5 text-[10px] font-medium text-white">
            <CheckCircle size={10} /> Done
          </span>
        )}
        {inProgress && (
          <span className="absolute right-2 top-2 rounded-md bg-brand/90 px-2 py-0.5 text-[10px] font-medium text-white">
            {fmtDuration(resumeAt)}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-white/95 text-brand shadow-lg opacity-0 transition group-hover:scale-100 group-hover:opacity-100">
            <PlayCircle size={26} className="ml-0.5" />
          </span>
        </span>
      </div>
      <div className="p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{section}</p>
        <h3 className="mt-0.5 line-clamp-2 font-semibold leading-snug text-slate-800 group-hover:text-brand">
          {v.title}
        </h3>
        {v.description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{v.description}</p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
          {completed ? (
            <span className="inline-flex items-center gap-1 font-medium text-green-600">
              <CheckCircle size={12} /> Completed
            </span>
          ) : inProgress ? (
            <span className="inline-flex items-center gap-1 font-medium text-brand">
              <Clock size={12} /> Resume from {fmtDuration(resumeAt)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <PlayCircle size={12} /> Not started
            </span>
          )}
          {views > 1 && (
            <>
              <span className="text-slate-300">·</span>
              <span>{views} views</span>
            </>
          )}
          {lastWatched && stats && (
            <>
              <span className="text-slate-300">·</span>
              <span>Last watched {fmtDay(lastWatched)}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function VideosSkeleton() {
  return (
    <div className="videos-page -mx-3 animate-pulse sm:-mx-4 md:mx-0">
      <div className="hidden space-y-6 md:block">
        <div className="h-8 w-56 rounded bg-slate-200" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-200" />)}
        </div>
      </div>
      <div className="md:hidden">
        <div className="h-10 border-b border-slate-100 bg-slate-100" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-3 px-3 py-2.5">
            <div className="aspect-video w-[168px] shrink-0 rounded-xl bg-slate-200" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3.5 w-full rounded bg-slate-200" />
              <div className="h-3 w-2/3 rounded bg-slate-100" />
              <div className="h-3 w-1/2 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryChip({
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

export function VideosPage() {
  const qc = useQueryClient();
  const [playing, setPlaying] = useState<{ video: VideoItem; startAt: number } | null>(null);
  const [mobileFilter, setMobileFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['videos-library'],
    // Videos only — PDF study material has its own page and its own viewer.
    queryFn: () => unwrap<VideoItem[]>(api.get('/videos/library', { params: { kind: 'video' } })),
  });
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => unwrap<Plan[]>(api.get('/payments/plans')),
  });
  const history = useQuery({
    queryKey: ['watch-history'],
    queryFn: () => unwrap<WatchItem[]>(api.get('/videos/history')),
  });
  const watch = useMutation({
    mutationFn: ({ id, ...body }: WatchPayload & { id: string }) =>
      unwrap(api.post(`/videos/${id}/watch`, body)),
    onSuccess: (_data, vars) => {
      if (vars.session_start || vars.completed || vars.flush) {
        qc.invalidateQueries({ queryKey: ['watch-history'] });
      }
    },
  });

  const historyMap = useMemo(() => {
    const map = new Map<string, WatchItem>();
    for (const item of history.data ?? []) {
      if (!map.has(item.video_id)) map.set(item.video_id, item);
    }
    return map;
  }, [history.data]);

  const play = (v: VideoItem) => {
    const stats = historyMap.get(v.id);
    const startAt = stats?.completed ? 0 : (stats?.last_position_s ?? 0);
    setPlaying({ video: v, startAt });
  };
  const videoOf = (id: string) => data?.find((v) => v.id === id);

  const planLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of plans.data ?? []) m.set(p.plan, p.label);
    return m;
  }, [plans.data]);

  const sectionGroups = useMemo(() => {
    const map: Record<string, VideoItem[]> = {};
    for (const v of data ?? []) {
      const key = videoSection(v, planLabels);
      (map[key] ??= []).push(v);
    }
    const order = ['General', 'Private', ...(plans.data ?? []).map((p) => p.label)];
    const keys = order.filter((k) => map[k]?.length);
    for (const k of Object.keys(map)) {
      if (!keys.includes(k)) keys.push(k);
    }
    return keys.map((k) => [k, map[k]] as const);
  }, [data, plans.data, planLabels]);

  const mobileVideos = useMemo(() => {
    if (mobileFilter === 'all') return data ?? [];
    return sectionGroups.find(([cat]) => cat === mobileFilter)?.[1] ?? [];
  }, [data, mobileFilter, sectionGroups]);

  const continueWatching = useMemo(
    () => (history.data ?? []).slice(0, 10).map((h) => ({ h, v: videoOf(h.video_id) })).filter((x) => x.v),
    [history.data, data],
  );

  const sectionCount = sectionGroups.length;
  const recentCount = historyMap.size;
  const totalViews = useMemo(
    () => [...historyMap.values()].reduce((sum, h) => sum + (h.view_count ?? 1), 0),
    [historyMap],
  );
  const totalVideos = data?.length ?? 0;

  if (isLoading || plans.isLoading) return <VideosSkeleton />;

  return (
    <div className="videos-page -mx-3 space-y-0 sm:-mx-4 md:mx-0 md:space-y-6">
      {/* Mobile: YouTube-style feed */}
      <div className="md:hidden">
        <div className="border-b border-slate-100 bg-white px-3 py-2.5">
          <h1 className="text-lg font-bold text-slate-900">Videos</h1>
        </div>

        {sectionCount > 1 && (
          <div className="flex gap-2 overflow-x-auto border-b border-slate-100 bg-white px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <CategoryChip active={mobileFilter === 'all'} onClick={() => setMobileFilter('all')}>
              All
            </CategoryChip>
            {sectionGroups.map(([cat]) => (
              <CategoryChip key={cat} active={mobileFilter === cat} onClick={() => setMobileFilter(cat)}>
                {cat}
              </CategoryChip>
            ))}
          </div>
        )}

        {!!continueWatching.length && mobileFilter === 'all' && (
          <section className="border-b border-slate-100/80 bg-slate-50/50 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 px-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand/10 text-brand">
                <History size={11} strokeWidth={2.5} />
              </span>
              <h2 className="text-[13px] font-semibold tracking-tight text-slate-800">Continue watching</h2>
              <span className="rounded-full bg-slate-200/80 px-1.5 py-px text-[10px] font-semibold tabular-nums text-slate-500">
                {continueWatching.length}
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {continueWatching.map(({ h, v }) => v && (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => play(v)}
                  className="group w-[148px] shrink-0 text-left"
                  aria-label={`Watch ${v.title}`}
                >
                  <div className="relative">
                    <Thumbnail v={v} stats={h} className="w-full" rounded="rounded-lg" />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 transition group-active:bg-black/20">
                      <PlayCircle size={22} className="text-white opacity-0 drop-shadow-md transition group-active:opacity-100" />
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-[1.25] text-slate-800">{v.title}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {!totalVideos ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <Video size={32} />
            </div>
            <h2 className="mt-4 text-base font-bold text-slate-800">No videos yet</h2>
            <p className="mt-2 text-sm text-slate-500">Learning content will appear here once published.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 bg-white">
            {mobileVideos.map((v) => (
              <VideoRow
                key={v.id}
                v={v}
                section={videoSection(v, planLabels)}
                stats={historyMap.get(v.id)}
                onPlay={() => play(v)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop: existing dashboard layout */}
      <div className="hidden md:block md:space-y-6">
        <PageHeader
          title="Learning Videos"
          description="Welcome, tutorial, and help videos to support your English journey"
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Available videos" value={totalVideos} icon={Video} hint={totalVideos ? 'Ready to watch' : 'None published yet'} />
          <StatTile label="Categories" value={sectionCount} icon={FolderOpen} hint={sectionCount ? 'General & your plan videos' : '—'} />
          <StatTile label="Watched" value={recentCount} icon={Clock} hint={recentCount ? `${totalViews} total views` : 'Start watching'} />
        </div>

        {totalVideos > 0 && (
          <div className="card overflow-hidden p-0">
            <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-5 text-white sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90">
                    <Sparkles size={14} /> Your library
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">
                    {totalVideos} video{totalVideos === 1 ? '' : 's'} across {sectionCount} categor{sectionCount === 1 ? 'y' : 'ies'}
                  </h2>
                  <p className="mt-1 text-sm text-white/80">Click any video to start — progress is saved automatically</p>
                </div>
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <PlayCircle size={28} />
                </div>
              </div>
            </div>
          </div>
        )}

        {!totalVideos ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Video size={32} />
            </div>
            <h2 className="mt-4 text-lg font-bold text-slate-800">No videos yet</h2>
            <p className="mt-2 text-sm text-slate-500">Learning content will appear here once published by the admin team.</p>
          </div>
        ) : (
          sectionGroups.map(([cat, vids]) => (
            <Section key={cat} title={cat} icon={FolderOpen} count={vids.length}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {vids.map((v) => (
                  <VideoCard key={v.id} v={v} section={cat} stats={historyMap.get(v.id)} onPlay={() => play(v)} />
                ))}
              </div>
            </Section>
          ))
        )}

        {!!history.data?.length && (
          <Section title="Recently watched" icon={History} description="Pick up where you left off" count={Math.min(5, history.data.length)}>
            <ul className="space-y-2">
              {history.data.slice(0, 5).map((h) => {
                const v = videoOf(h.video_id);
                const thumb = v ? videoThumbnail(v) : null;
                return (
                  <li key={h.id}>
                    {v ? (
                      <button
                        type="button"
                        onClick={() => play(v)}
                        aria-label={`Watch ${v.title}`}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-2 text-left text-sm transition hover:border-brand/30 hover:bg-white"
                      >
                        <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-slate-900">
                          {thumb ? (
                            <img src={thumb} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full items-center justify-center text-white/40">
                              <Video size={18} />
                            </span>
                          )}
                          <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                            <PlayCircle size={16} className="text-white drop-shadow" />
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-700">{v.title}</span>
                          {watchSummary(h) && (
                            <span className="mt-0.5 block truncate text-xs text-slate-400">{watchSummary(h)}</span>
                          )}
                        </span>
                        <span className="shrink-0 pr-2 text-xs text-slate-400">{fmtDay(h.watched_at || h.created_at)}</span>
                      </button>
                    ) : (
                      <div className="flex justify-between rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
                        <span>Video unavailable</span>
                        <span className="text-xs text-slate-400">{fmtDay(h.watched_at || h.created_at)}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </div>

      {playing && (
        <Player
          v={playing.video}
          section={videoSection(playing.video, planLabels)}
          startAt={playing.startAt}
          onClose={() => setPlaying(null)}
          onProgress={(body) => watch.mutate({ id: playing.video.id, ...body })}
        />
      )}
    </div>
  );
}
