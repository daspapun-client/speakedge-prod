import { useState } from 'react';
import { ArrowRight, Download, Monitor, MoreVertical, Plus, Share, Smartphone, Sparkles, X } from 'lucide-react';
import iconUrl from '@/asset/logo-icon.png';
import { type InstallGuide, usePwaInstall } from '@/lib/usePwaInstall';

function InstallGuideModal({
  open,
  guide,
  onClose,
}: {
  open: boolean;
  guide: InstallGuide;
  onClose: () => void;
}) {
  if (!open) return null;

  const steps =
    guide === 'ios'
      ? [
          <>Tap <Share size={14} className="mb-0.5 inline text-brand" aria-hidden /> Share in Safari&apos;s toolbar</>,
          <>Scroll and tap <Plus size={14} className="mb-0.5 inline text-brand" aria-hidden /> Add to Home Screen</>,
          <>Tap Add — SpeakEdge will appear on your home screen</>,
        ]
      : guide === 'android'
        ? [
            <>Tap <MoreVertical size={14} className="mb-0.5 inline text-brand" aria-hidden /> the menu in Chrome (top right)</>,
            <>Tap <Download size={14} className="mb-0.5 inline text-brand" aria-hidden /> Install app or Add to Home screen</>,
            <>Confirm — SpeakEdge will appear on your home screen</>,
          ]
        : [
            <>Look for the <Download size={14} className="mb-0.5 inline text-brand" aria-hidden /> install icon in your browser&apos;s address bar</>,
            <>Or open the browser menu and choose Install SpeakEdge / Install app</>,
            <>Click Install — SpeakEdge opens in its own window like a desktop app</>,
          ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add to Home Screen</h2>
            <p className="mt-1 text-sm text-slate-500">Install SpeakEdge for quick access, just like an app.</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <ol className="mt-5 space-y-4 text-sm text-slate-700">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        <button type="button" className="btn-primary mt-5 w-full" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}

export function PwaInstallSection({ className = '' }: { className?: string }) {
  const { showSection, hasNativePrompt, install } = usePwaInstall();
  const [guideOpen, setGuideOpen] = useState<InstallGuide | null>(null);
  const [busy, setBusy] = useState(false);

  if (!showSection) return null;

  const handleClick = async () => {
    setBusy(true);
    try {
      const result = await install();
      if (result === 'ios' || result === 'android' || result === 'desktop') {
        setGuideOpen(result);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={`relative overflow-hidden rounded-2xl shadow-[0_12px_40px_rgba(47,128,237,0.22)] ring-1 ring-brand/15 ${className}`}>
        <div className="relative overflow-hidden bg-gradient-to-br from-[#1557b0] via-brand to-brand-light px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/15 blur-3xl" />
            <div className="absolute -bottom-10 -left-6 h-24 w-24 rounded-full bg-brand-gold/30 blur-2xl" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_90%_10%,rgba(255,255,255,0.12),transparent_50%)]" />
          </div>

          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
            <div className="flex min-w-0 items-center gap-3.5 lg:flex-1">
              <div className="relative shrink-0">
                <div className="rounded-[1.1rem] bg-gradient-to-br from-white/50 to-brand-gold/50 p-[2px] shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
                  <img
                    src={iconUrl}
                    alt=""
                    className="h-12 w-12 rounded-[0.95rem] object-cover sm:h-14 sm:w-14"
                  />
                </div>
                <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-gold text-slate-900 shadow-md ring-2 ring-white/80">
                  <Smartphone size={12} className="lg:hidden" aria-hidden />
                  <Monitor size={12} className="hidden lg:block" aria-hidden />
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/95 ring-1 ring-white/25 backdrop-blur-sm">
                  <Sparkles size={10} className="shrink-0 text-brand-gold" aria-hidden />
                  Install app
                </span>
                <h2 className="mt-1.5 text-base font-extrabold leading-tight tracking-tight lg:text-lg">
                  Get SpeakEdge on your home screen
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-white/80 lg:max-w-xl lg:text-sm">
                  {hasNativePrompt
                    ? 'One-tap install — opens like a native app, works offline, no app store needed.'
                    : 'Save to your home screen or desktop for instant access anytime.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-brand shadow-[0_4px_14px_rgba(0,0,0,0.15)] transition active:scale-[0.98] hover:bg-brand-gold hover:text-slate-900 disabled:opacity-60 lg:w-auto lg:px-6 lg:py-3"
              onClick={handleClick}
              disabled={busy}
            >
              <Download size={16} aria-hidden />
              Add to Home Screen
              <ArrowRight size={16} className="hidden lg:block" aria-hidden />
            </button>
          </div>
        </div>
      </section>
      <InstallGuideModal
        open={guideOpen !== null}
        guide={guideOpen ?? 'desktop'}
        onClose={() => setGuideOpen(null)}
      />
    </>
  );
}
