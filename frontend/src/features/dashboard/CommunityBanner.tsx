import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ImagePlus, Move, MessageCircle } from 'lucide-react';

export const BANNER_ASPECT = 3.5;
export const BANNER_EXPORT = { w: 1400, h: 400 };

export type BannerPos = { x: number; y: number };

export function cropBanner(image: HTMLImageElement, pos: BannerPos): Promise<File> {
  const { w: outW, h: outH } = BANNER_EXPORT;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas unavailable'));

  const scale = Math.max(outW / image.naturalWidth, outH / image.naturalHeight);
  const drawW = image.naturalWidth * scale;
  const drawH = image.naturalHeight * scale;
  const x = (outW - drawW) * (pos.x / 100);
  const y = (outH - drawH) * (pos.y / 100);
  ctx.drawImage(image, x, y, drawW, drawH);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], 'banner.jpg', { type: 'image/jpeg' })) : reject(new Error('Export failed'))),
      'image/jpeg',
      0.88,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

export function CommunityBannerDisplay({
  src,
  fallbackClass,
  name,
  compact,
  bare,
  chatHeader,
  fill,
}: {
  src?: string | null;
  fallbackClass: string;
  name?: string;
  compact?: boolean;
  /** Card header — image only, no icon/name overlays */
  bare?: boolean;
  /** Fixed-height strip for team chat (no aspect ratio) */
  chatHeader?: boolean;
  /** Stretch to parent height (use inside a sized wrapper) */
  fill?: boolean;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden ${
        fill
          ? 'h-full'
          : chatHeader
            ? 'h-[4.5rem] sm:h-20'
            : bare
              ? 'aspect-[2/1] min-h-[7rem]'
              : compact
                ? 'aspect-[3.5/1] min-h-[5rem]'
                : 'aspect-[3.5/1] min-h-[6.5rem]'
      }`}
    >
      {src ? (
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover object-center" draggable={false} />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${fallbackClass}`} />
      )}
      <div className={`absolute inset-0 ${bare ? 'bg-gradient-to-t from-black/50 via-black/10 to-transparent' : 'bg-gradient-to-t from-black/55 via-black/15 to-black/5'}`} />
      {!bare && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_55%)]" />
      )}
      {!bare && name && (
        <p className="absolute bottom-3 right-4 max-w-[55%] truncate text-right text-sm font-bold text-white drop-shadow-md">
          {name}
        </p>
      )}
      {!bare && (
        <div className="absolute bottom-3 left-4 flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/90 shadow-lg backdrop-blur-sm">
          <MessageCircle size={18} className="text-brand" />
        </div>
      )}
    </div>
  );
}

export function BannerEditor({
  initialSrc,
  fallbackClass,
  name,
  onReadyChange,
}: {
  initialSrc?: string | null;
  fallbackClass: string;
  name: string;
  onReadyChange: (state: {
    hasImage: boolean;
    removed: boolean;
    dirty: boolean;
    exportFile: () => Promise<File | null>;
  }) => void;
}) {
  const [src, setSrc] = useState<string | null>(initialSrc ?? null);
  const [pos, setPos] = useState<BannerPos>({ x: 50, y: 50 });
  const [removed, setRemoved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastPt = useRef({ x: 0, y: 0 });

  const exportFile = useCallback(async (): Promise<File | null> => {
    if (removed || !src) return null;
    const img = imgRef.current ?? await loadImage(src);
    imgRef.current = img;
    return cropBanner(img, pos);
  }, [pos, removed, src]);

  useEffect(() => {
    onReadyChange({ hasImage: !!src && !removed, removed, dirty, exportFile });
  }, [src, removed, dirty, pos, exportFile, onReadyChange]);

  const pickFile = (file: File | null) => {
    if (!file) return;
    setRemoved(false);
    setDirty(true);
    setPos({ x: 50, y: 50 });
    imgRef.current = null;
    setSrc((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const clear = () => {
    setRemoved(true);
    setDirty(true);
    setPos({ x: 50, y: 50 });
    imgRef.current = null;
    setSrc((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!src || removed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    lastPt.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastPt.current.x;
    const dy = e.clientY - lastPt.current.y;
    lastPt.current = { x: e.clientX, y: e.clientY };
    setPos((p) => {
      const next = {
        x: Math.min(100, Math.max(0, p.x - dx * 0.2)),
        y: Math.min(100, Math.max(0, p.y - dy * 0.2)),
      };
      if (next.x !== p.x || next.y !== p.y) setDirty(true);
      return next;
    });
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const showImage = src && !removed;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="label mb-0">
          Banner photo <span className="font-normal text-slate-400">(optional)</span>
        </label>
        {showImage && (
          <div className="flex gap-2">
            <label className="cursor-pointer text-xs font-medium text-brand hover:underline">
              Change
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={clear}>
              Remove
            </button>
          </div>
        )}
      </div>

      {showImage ? (
        <div
          className={`relative overflow-hidden rounded-xl border border-slate-200 shadow-inner ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ aspectRatio: BANNER_ASPECT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={src}
            alt=""
            className="absolute inset-0 h-full w-full select-none object-cover"
            style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
            draggable={false}
            onLoad={(e) => { imgRef.current = e.currentTarget; }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-black/5" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_55%)]" />
          {name.trim() && (
            <p className="pointer-events-none absolute bottom-3 right-4 max-w-[55%] truncate text-right text-sm font-bold text-white drop-shadow-md">
              {name.trim()}
            </p>
          )}
          <div className="pointer-events-none absolute bottom-3 left-4 flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/90 shadow-lg backdrop-blur-sm">
            <MessageCircle size={18} className="text-brand" />
          </div>
          <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
            <Move size={12} /> Drag to reposition
          </div>
        </div>
      ) : (
        <label
          className={`flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-gradient-to-br ${fallbackClass} px-4 py-10 text-sm text-white transition hover:border-white/60 hover:brightness-105`}
          style={{ aspectRatio: BANNER_ASPECT, minHeight: '6.5rem' }}
        >
          <ImagePlus size={28} className="mb-2 opacity-90" />
          <span className="font-medium">Add a banner photo</span>
          <span className="mt-1 text-xs text-white/75">JPEG, PNG or WebP — drag to adjust after upload</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}

      {!showImage && (
        <p className="text-xs text-slate-400">Preview matches how your community class card will look.</p>
      )}
    </div>
  );
}

export function bannerFallback(id: string) {
  const COVERS = [
    'from-indigo-500 to-purple-600', 'from-brand to-brand-light', 'from-amber-500 to-pink-500',
    'from-emerald-500 to-teal-600', 'from-sky-500 to-blue-600', 'from-rose-500 to-orange-500',
  ];
  return COVERS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COVERS.length];
}
