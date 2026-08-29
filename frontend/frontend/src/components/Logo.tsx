import iconUrl from '@/asset/logo-icon.png';

type LogoSize = 'sm' | 'md' | 'lg';

const SIZES: Record<LogoSize, { box: string; text: string }> = {
  sm: { box: 'h-8 w-8 rounded-lg p-0.5', text: 'text-lg' },
  md: { box: 'h-10 w-10 rounded-xl p-1', text: 'text-xl' },
  lg: { box: 'h-14 w-14 rounded-2xl p-1.5', text: 'text-3xl' },
};

/**
 * SpeakEdge brand lockup — icon mark in a rounded tile paired with a
 * typographic wordmark. Set `showWordmark={false}` for the icon alone.
 */
export function Logo({
  size = 'md',
  showWordmark = true,
  className = '',
}: {
  size?: LogoSize;
  showWordmark?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        className={`inline-flex items-center justify-center bg-white shadow-sm ring-1 ring-slate-200/70 ${s.box}`}
      >
        <img
          src={iconUrl}
          alt={showWordmark ? '' : 'SpeakEdge'}
          className="h-full w-full object-contain"
        />
      </span>
      {showWordmark && (
        <span className={`font-extrabold tracking-tight text-brand ${s.text}`}>
          Speak<span className="text-brand-gold">Edge</span>
        </span>
      )}
    </span>
  );
}
