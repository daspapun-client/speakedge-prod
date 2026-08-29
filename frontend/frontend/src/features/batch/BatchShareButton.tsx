import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Facebook, Link2, MessageCircle, Share2 } from 'lucide-react';
import { batchJoinShareText, batchJoinUrl } from '@/features/batch/joinLink';

export function BatchShareButton({
  batchId,
  title,
  variant = 'default',
}: {
  batchId: string;
  title: string;
  variant?: 'default' | 'overlay';
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const url = batchJoinUrl(batchId);
  const text = batchJoinShareText(title);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function copyLink() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function nativeShare() {
    if (!navigator.share) return;
    await navigator.share({ title: `Join ${title}`, text, url });
    setOpen(false);
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
  const facebook = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;

  const btnClass =
    variant === 'overlay'
      ? 'inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm ring-1 ring-slate-200/80 backdrop-blur-sm transition hover:bg-white hover:text-brand'
      : 'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-brand/30 hover:bg-brand/5 hover:text-brand';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={btnClass}
        title="Share join link"
        aria-label="Share batch join link"
      >
        <Share2 size={variant === 'overlay' ? 14 : 16} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-medium text-slate-500">
            Share join link
          </p>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => { copyLink(); }}
          >
            {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} className="text-slate-400" />}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          {'share' in navigator && (
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={() => { nativeShare().catch(() => {}); }}
            >
              <Share2 size={15} className="text-slate-400" />
              Share…
            </button>
          )}
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            <MessageCircle size={15} className="text-emerald-600" />
            WhatsApp
          </a>
          <a
            href={facebook}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            <Facebook size={15} className="text-[#1877F2]" />
            Facebook
          </a>
          <div className="border-t border-slate-100 px-3 py-2">
            <p className="flex items-start gap-1.5 text-[10px] leading-snug text-slate-400">
              <Link2 size={11} className="mt-0.5 shrink-0" />
              Students log in and join per their plan limit
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
