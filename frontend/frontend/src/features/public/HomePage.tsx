import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Award,
  BadgeCheck,
  Bot,
  BookOpen,
  Brain,
  CalendarClock,
  CheckCircle2,
  Ear,
  Gauge,
  Globe,
  GraduationCap,
  Home,
  Key,
  Languages,
  Building2,
  MessageSquare,
  Mic,
  PlayCircle,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import bookCoverUrl from '@/asset/speakedge-book-cover.png';
import { admissionOf, planRupees, useLowestAdmissionPrice, usePublicPlans, type PlanPrice } from '@/lib/plans';

/* ------------------------------------------------------------------ helpers */

function SectionHeading({
  eyebrow,
  title,
  subtitle,
  light,
  align = 'center',
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  light?: boolean;
  align?: 'center' | 'left';
}) {
  return (
    <div
      className={`mx-auto max-w-3xl ${
        align === 'left' ? 'text-center md:mx-0 md:text-left' : 'text-center'
      }`}
    >
      {eyebrow && (
        <span
          className={`badge ${
            light ? 'bg-white/15 text-white' : 'bg-brand-gold/20 text-brand'
          }`}
        >
          {eyebrow}
        </span>
      )}
      <h2
        className={`mt-3 text-balance text-2xl font-extrabold leading-tight sm:mt-4 sm:text-3xl md:text-4xl ${
          light ? 'text-white' : 'text-slate-900'
        }`}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className={`mt-3 text-base leading-relaxed sm:mt-4 sm:text-lg ${
            light ? 'text-white/80' : 'text-slate-600'
          }`}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, inView };
}

function Counter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const duration = 1600;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(eased * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, target]);
  return (
    <span ref={ref}>
      {value.toLocaleString('en-IN')}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ 1. Hero */

/**
 * Note: "20,000+" and "Since 2009" belong to Sujyoti Language School — never to
 * SpeakEdge or Sujyoti EdTech. Keep the attribution in the label wherever these
 * two figures appear.
 */
const TRUST = [
  { icon: Users, value: '20,000+', label: 'Learners Empowered through Sujyoti Language School' },
  { icon: CalendarClock, value: 'Since 2009', label: 'Educational Experience of Sujyoti Language School' },
  { icon: Award, value: 'CEFR Aligned', label: 'Learning & Certification' },
  { icon: Bot, value: 'AI + Human', label: 'Integrated Learning Model' },
] as const;

function HeroTrustBar() {
  return (
    <div className="hero-rise hero-rise-d6 mt-10 sm:mt-12 lg:mt-14">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-brand-gold/[0.04]"
        />
        <div className="relative grid grid-cols-2 gap-px bg-white/[0.08] sm:grid-cols-4">
          {TRUST.map((t) => (
            <div
              key={t.label}
              className="group flex flex-col gap-2.5 bg-[#002244]/50 px-4 py-4 transition hover:bg-white/[0.06] sm:px-5 sm:py-5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-gold/20 to-brand-gold/5 ring-1 ring-brand-gold/25 transition group-hover:ring-brand-gold/45">
                <t.icon size={16} className="text-brand-gold" strokeWidth={2} />
              </div>
              <div>
                <p className="text-sm font-bold leading-tight text-white lg:text-base">
                  {t.value}
                </p>
                <p className="mt-0.5 text-[10px] font-medium leading-snug text-blue-100/55 sm:text-[11px]">
                  {t.label}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-blue-100/60 sm:text-xs">
        SpeakEdge combines Sujyoti EdTech&apos;s technology with educational methodologies inspired by
        the experience of Sujyoti Language School since 2009.
      </p>
    </div>
  );
}

const FLOATING = [
  { icon: BookOpen, label: 'One Book' },
  { icon: Bot, label: 'AI Practice' },
  { icon: Languages, label: 'British · American · International' },
  { icon: Users, label: 'English Speaking Community Access' },
  { icon: Mic, label: 'Interview · IELTS · Public Speaking' },
  { icon: MessageSquare, label: 'Conversation · GD · Storytelling · Debate' },
];

const SPINE_STEPS = [
  { icon: BadgeCheck, title: 'Membership', sub: 'Choose Your Membership', highlight: true },
  { icon: BookOpen, title: 'SpeakEdge Book', sub: 'Your Learning & Practice Guide', highlight: false },
  { icon: Key, title: 'Activation Code', sub: 'Activate Your SpeakEdge Access', highlight: false },
  {
    icon: GraduationCap,
    title: 'Full Ecosystem',
    sub: 'AI Practice · Speaking Community · Live Learning · CEFR Assessment & Certification',
    highlight: false,
  },
] as const;

const SPINE_SHORT_MOBILE = ['Member', 'Book', 'Code', 'Access'] as const;

function IdentitySpineStep({
  step,
  label,
  size = 'md',
}: {
  step: (typeof SPINE_STEPS)[number];
  label: string;
  size?: 'sm' | 'md';
}) {
  const iconBox =
    size === 'sm'
      ? 'h-8 w-8'
      : 'h-9 w-9';
  const iconSize = size === 'sm' ? 15 : 16;
  const labelClass =
    size === 'sm'
      ? 'text-[11px] font-semibold leading-tight'
      : 'text-xs font-semibold leading-tight';

  return (
    <div className="relative z-[1] flex flex-col items-center gap-1.5">
      <div
        className={`flex items-center justify-center rounded-full ${iconBox} ${
          step.highlight
            ? 'bg-gradient-to-br from-brand-gold via-amber-300 to-brand-gold text-slate-900 shadow-lg shadow-brand-gold/35 ring-2 ring-brand-gold/50'
            : 'border border-white/30 bg-white/12 text-white shadow-md shadow-brand/15'
        }`}
      >
        <step.icon size={iconSize} strokeWidth={2.25} aria-hidden />
      </div>
      <span
        className={`w-full truncate text-center ${labelClass} ${
          step.highlight ? 'text-brand-gold' : 'text-white/90'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

/** Six ecosystem chips — 2×3 grid everywhere, compact on mobile. */
function FloatingChips({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div
      className={`grid grid-cols-2 ${compact ? 'gap-2' : 'gap-2.5 lg:gap-3 xl:gap-3.5'} ${className}`}
    >
      {FLOATING.map((f, i) => {
        const isAi = f.label === 'AI Practice';
        return (
          <div
            key={f.label}
            className={`se-glass se-glass-chip group relative flex items-center overflow-hidden font-medium leading-snug text-white/95 ${
              compact
                ? 'gap-2 rounded-xl px-2.5 py-2.5 text-[11px]'
                : 'gap-3 rounded-2xl px-3.5 py-3 text-xs lg:px-4 lg:py-3.5 lg:text-sm'
            } ${isAi ? 'se-glass-chip-ai' : ''}`}
            style={{ '--chip-delay': `${0.72 + i * 0.1}s` } as React.CSSProperties}
          >
            <div
              className={`se-glass-chip-icon flex shrink-0 items-center justify-center rounded-lg bg-white/10 ${
                compact ? 'h-7 w-7' : 'h-9 w-9 rounded-xl lg:h-10 lg:w-10'
              }`}
            >
              <f.icon
                size={compact ? 15 : 18}
                className={isAi ? 'se-icon-glow se-icon-glow-ai' : 'se-icon-glow'}
              />
            </div>
            <span className="relative z-[1] min-w-0">{f.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function IdentitySpineDesktop() {
  return (
    <div aria-label="The SpeakEdge Journey" className="hero-slide-in">
      <div className="relative mx-auto max-w-sm lg:max-w-md xl:max-w-lg">
        <div
          aria-hidden
          className="hero-glow-ring pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-brand-gold/40 via-white/20 to-brand-light/35"
        />
        <div className="relative overflow-hidden rounded-3xl border border-white/25 bg-white/10 p-6 shadow-2xl shadow-brand/30 backdrop-blur-xl lg:p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-brand-gold/12 blur-3xl lg:h-48 lg:w-48"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-brand-light/15 blur-2xl"
          />

          <div className="relative flex items-center gap-2.5 lg:gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand-gold shadow-[0_0_12px_rgba(212,175,55,0.75)]" />
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-white lg:text-sm lg:tracking-[0.16em]">
              The SpeakEdge Journey
            </span>
          </div>

          <ol className="relative mt-6 lg:mt-8">
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-5 left-[18px] top-5 w-0.5 rounded-full bg-gradient-to-b from-white/20 via-brand-gold/55 to-white/20 lg:left-[21px]"
            />
            {SPINE_STEPS.map((step, i) => (
              <li
                key={step.title}
                className={`hero-spine-step relative flex gap-3.5 lg:gap-4 ${i > 0 ? 'mt-3 lg:mt-4' : ''}`}
                style={{ animationDelay: `${0.5 + i * 0.13}s` }}
              >
                <div className="relative z-[1] shrink-0 pt-3 lg:pt-3.5">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full transition-transform group-hover:scale-105 lg:h-10 lg:w-10 ${
                      step.highlight
                        ? 'bg-gradient-to-br from-brand-gold via-amber-300 to-brand-gold text-slate-900 shadow-lg shadow-brand-gold/40 ring-2 ring-brand-gold/45'
                        : 'border border-white/30 bg-white/12 text-white shadow-md shadow-brand/20'
                    }`}
                  >
                    <step.icon size={17} strokeWidth={2.25} className="lg:hidden" aria-hidden />
                    <step.icon size={18} strokeWidth={2.25} className="hidden lg:block" aria-hidden />
                  </div>
                </div>
                <div
                  className={`group min-w-0 flex-1 rounded-2xl px-4 py-3 transition hover:-translate-y-0.5 lg:px-5 lg:py-3.5 ${
                    step.highlight
                      ? 'border border-brand-gold/40 bg-gradient-to-br from-brand-gold via-amber-200 to-brand-gold text-slate-900 shadow-lg shadow-brand-gold/30'
                      : 'border border-white/15 bg-white/[0.08] hover:border-white/25 hover:bg-white/12'
                  }`}
                >
                  <p
                    className={`text-sm font-semibold leading-tight lg:text-base ${
                      step.highlight ? 'text-slate-900' : 'text-white'
                    }`}
                  >
                    {step.title}
                  </p>
                  {step.sub && (
                    <p
                      className={`mt-0.5 text-xs leading-snug lg:text-sm ${
                        step.highlight ? 'text-slate-800/80' : 'text-blue-100/75'
                      }`}
                    >
                      {step.sub}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <FloatingChips className="mt-6 lg:mt-8" />
    </div>
  );
}

function IdentitySpineMobile({ compact }: { compact?: boolean }) {
  const shell = compact
    ? 'rounded-2xl p-3.5'
    : 'rounded-2xl p-4';

  return (
    <div className="md:hidden" aria-label="The SpeakEdge Journey">
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-brand-gold/35 via-white/20 to-brand-light/30"
        />
        <div
          className={`relative overflow-hidden border border-white/25 bg-white/10 shadow-xl shadow-brand/20 backdrop-blur-md ${shell}`}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-brand-gold/15 blur-2xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-8 -left-8 h-20 w-20 rounded-full bg-brand-light/20 blur-2xl"
          />

          <div
            className={`relative flex items-center gap-2 ${
              compact ? 'mb-3' : 'mb-3.5 justify-center'
            }`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold shadow-[0_0_10px_rgba(212,175,55,0.7)]" />
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white">
              The SpeakEdge Journey
            </span>
          </div>

          <div className="relative grid grid-cols-4 gap-1.5">
            <div
              aria-hidden
              className={`pointer-events-none absolute left-[12.5%] right-[12.5%] h-0.5 rounded-full bg-gradient-to-r from-white/15 via-brand-gold/50 to-white/15 ${
                compact ? 'top-[17px]' : 'top-[19px]'
              }`}
            />
            {SPINE_STEPS.map((step, i) => (
              <IdentitySpineStep
                key={step.title}
                step={step}
                label={SPINE_SHORT_MOBILE[i]}
                size={compact ? 'sm' : 'md'}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#002244] text-white">
      {/* Base gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand via-[#003566] to-[#001a33]"
      />
      {/* Animated ambient orbs */}
      <div
        aria-hidden
        className="hero-orb pointer-events-none absolute -left-24 top-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(47,128,237,0.35)_0%,transparent_70%)] blur-3xl lg:h-[520px] lg:w-[520px]"
      />
      <div
        aria-hidden
        className="hero-orb-b pointer-events-none absolute -right-32 bottom-0 h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgba(47,128,237,0.2)_0%,transparent_70%)] blur-3xl lg:h-[480px] lg:w-[480px]"
      />
      <div
        aria-hidden
        className="hero-orb-c pointer-events-none absolute right-[20%] top-[8%] h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.12)_0%,transparent_70%)] blur-3xl"
      />
      {/* Light pools (static depth) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_15%_15%,rgba(47,128,237,0.18),transparent_55%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_45%_35%_at_90%_75%,rgba(47,128,237,0.1),transparent_55%)]"
      />
      {/* Subtle grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px] lg:bg-[size:64px_64px] [mask-image:linear-gradient(to_bottom,black_40%,transparent_95%)]"
      />
      {/* Section edge fade */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#002244]/80 to-transparent lg:h-28"
      />

      <div className="relative mx-auto max-w-7xl px-5 pb-12 pt-8 sm:px-6 sm:pb-20 sm:pt-14 lg:pb-24 lg:pt-16 xl:pb-28 xl:pt-20">
        <div className="grid items-start gap-10 md:grid-cols-2 md:gap-14 lg:gap-16 xl:gap-20">
          {/* Copy + actions */}
          <div className="max-w-xl text-left sm:mx-auto sm:text-center md:mx-0 md:max-w-none md:text-left">
            <div className="hero-rise inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 backdrop-blur-md sm:mx-auto md:mx-0">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-gold opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-gold" />
              </span>
              <Sparkles size={14} className="shrink-0 text-brand-gold/90" aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90 sm:text-xs sm:tracking-[0.1em]">
                The Complete English Communication Ecosystem
              </span>
            </div>

            <h1 className="hero-rise hero-rise-d1 mt-6 text-balance text-[2.25rem] font-bold leading-[1.06] tracking-[-0.025em] min-[380px]:text-[2.5rem] sm:mt-7 sm:text-6xl sm:leading-[1.02] lg:text-7xl lg:tracking-[-0.03em] xl:text-[5rem]">
              Speak
              <span className="hero-shimmer-text bg-gradient-to-r from-brand-gold via-amber-100 to-brand-gold bg-clip-text text-transparent">
                Edge
              </span>
            </h1>

            <p className="hero-rise hero-rise-d2 mt-4 max-w-lg text-balance text-lg font-medium leading-snug text-white/95 sm:mx-auto sm:text-2xl md:mx-0 lg:mt-5 lg:text-[1.75rem] lg:leading-snug">
              Practice with{' '}
              <span className="font-semibold text-sky-200">AI</span>
              . Perform with{' '}
              <span className="font-semibold text-brand-gold">Humans</span>
              .
            </p>

            <p className="hero-rise hero-rise-d3 mt-3 max-w-lg text-sm leading-relaxed text-blue-100/70 sm:mx-auto sm:text-base md:mx-0 lg:mt-4 lg:max-w-xl lg:text-lg lg:leading-relaxed lg:text-blue-100/75">
              Join SpeakEdge and enter a complete English communication ecosystem — combining
              structured book-based learning, AI practice, human interaction and CEFR-aligned
              development.
            </p>

            <div className="hero-rise hero-rise-d4 mt-6 md:hidden">
              <IdentitySpineMobile compact />
              <FloatingChips compact className="mt-3 sm:hidden" />
            </div>

            <div className="hero-rise hero-rise-d5 mt-8 sm:mt-9 lg:mt-10">
              <div className="flex flex-col gap-3 sm:mx-auto sm:max-w-md sm:flex-row sm:flex-wrap sm:justify-center md:mx-0 md:max-w-none md:justify-start">
                <Link
                  to="/plans"
                  className="group inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-gold px-6 py-3 text-sm font-bold text-slate-900 shadow-lg shadow-brand-gold/20 transition hover:brightness-105 hover:shadow-brand-gold/35 active:scale-[0.98] sm:min-h-[44px] sm:flex-1 sm:px-5 md:flex-none lg:px-8 lg:text-base"
                >
                  Explore Membership
                  <ArrowRight
                    size={16}
                    className="shrink-0 transition-transform group-hover:translate-x-1"
                  />
                </Link>
                {/* The SpeakEdge Book is only sold with a membership, so this
                    goes to the plans page, not the general books catalogue. */}
                <Link
                  to="/plans"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/15 active:scale-[0.98] sm:min-h-[44px] sm:flex-1 md:flex-none"
                >
                  <BookOpen size={16} className="shrink-0 text-brand-gold" />
                  Get Your SpeakEdge Book
                </Link>
                <Link
                  to="/demo"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/15 active:scale-[0.98] sm:min-h-[44px] sm:flex-1 md:flex-none"
                >
                  <PlayCircle size={16} className="shrink-0 text-brand-gold" />
                  Free Demo
                </Link>
              </div>

              {/* Book buyers are told to activate from the home page, so this has
                  to be findable at a glance — a highlighted panel rather than a
                  text link, outlined so it still reads as secondary to the gold
                  primary CTA above it. */}
              <div className="mt-4 sm:mx-auto sm:max-w-md md:mx-0 md:max-w-none">
                <Link
                  to="/activate"
                  className="group inline-flex w-full items-center gap-3 rounded-xl border border-brand-gold/60 bg-brand-gold/10 px-4 py-3 text-left transition hover:border-brand-gold hover:bg-brand-gold/15 active:scale-[0.99] md:w-auto"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-gold/20 text-brand-gold">
                    <Key size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-brand-gold">Activate Membership</span>
                    <span className="block text-xs leading-snug text-blue-100/80">
                      Purchased the SpeakEdge Book? Activate with your code.
                    </span>
                  </span>
                  <ArrowRight
                    size={16}
                    className="ml-auto shrink-0 text-brand-gold transition-transform group-hover:translate-x-1"
                  />
                </Link>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 sm:justify-center md:justify-start">
                <a
                  href="#community"
                  className="group inline-flex items-center gap-1.5 text-sm font-medium text-blue-100/75 transition hover:text-brand-gold"
                >
                  Join the Speaking Community
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </a>
                <span className="hidden h-3 w-px bg-white/20 sm:block" aria-hidden />
                <a
                  href="#how"
                  className="group hidden items-center gap-1.5 text-sm font-medium text-blue-100/75 transition hover:text-white sm:inline-flex"
                >
                  <PlayCircle size={14} className="text-brand-gold/90" />
                  How it works
                </a>
              </div>
            </div>

            <HeroTrustBar />
          </div>

          {/* Identity spine + features — desktop */}
          <div className="hidden min-w-0 md:block">
            <IdentitySpineDesktop />
          </div>

          {/* Tablet-only spine (sm–md) */}
          <div className="hidden sm:block md:hidden">
            <IdentitySpineMobile />
            <FloatingChips className="mt-4 hidden sm:grid" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ 2. NRP Method */

const NRP_CARDS = [
  { icon: Sparkles, title: 'Learn Naturally', body: 'Absorb English the way you learned your mother tongue.' },
  { icon: Brain, title: 'No Memorization', body: 'Understanding over rote — patterns, not word lists.' },
  { icon: MessageSquare, title: 'Communicate Confidently', body: 'Speak from day one through real communication.' },
  { icon: Gauge, title: 'Build Fluency Faster', body: 'Consistent exposure compounds into natural acquisition.' },
];

const NRP_STEPS = ['Understanding', 'Exposure', 'Communication', 'Natural Acquisition'];

function NrpMethod() {
  return (
    <section id="about" className="scroll-mt-28 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:mx-auto sm:text-center">
          <span className="badge bg-brand-gold/20 text-brand">The NRP Method</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-slate-900 min-[380px]:text-2xl sm:mt-4 sm:text-3xl md:text-4xl">
            Learn English the Way You Learnt Your Mother Tongue
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600 sm:mx-auto sm:mt-4 sm:max-w-3xl sm:text-lg">
            No memorization. Just understanding, exposure, communication and natural acquisition.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
          {NRP_CARDS.map((c) => (
            <div
              key={c.title}
              className="flex gap-3.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 transition hover:-translate-y-1 hover:border-brand/20 hover:bg-white hover:shadow-md sm:block sm:p-5"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand sm:h-11 sm:w-11">
                <c.icon className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900 sm:mt-4 sm:text-lg">{c.title}</h3>
                <p className="mt-0.5 text-sm leading-snug text-slate-600 sm:mt-1">{c.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 sm:mt-14">
          <p className="mb-3 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:text-center">
            The Learning Path
          </p>
          <div className="grid grid-cols-2 gap-2 sm:hidden">
            {NRP_STEPS.map((s, i) => (
              <div
                key={s}
                className="flex items-center gap-2 rounded-lg border border-brand/15 bg-brand/[0.04] px-3 py-2.5"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-xs font-semibold leading-tight text-brand">{s}</span>
              </div>
            ))}
          </div>
          <div className="hidden flex-wrap items-center justify-center gap-2 sm:flex md:gap-3">
            {NRP_STEPS.map((s, i) => (
              <Fragment key={s}>
                {i > 0 && <ArrowRight className="shrink-0 text-brand-gold" size={18} />}
                <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-2.5 text-center text-sm font-semibold text-brand sm:px-5 sm:py-3 sm:text-base">
                  {s}
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------- 3. Practice with AI / Humans */

const AI_STEPS = [
  { icon: Bot, title: 'Practice with AI', body: 'Rehearse anytime with your AI speaking partner.' },
  { icon: Sparkles, title: 'Improve with AI Feedback', body: 'Instant feedback on fluency and pronunciation.' },
  { icon: Target, title: 'Performance Assessment', body: 'Measure progress against clear benchmarks.' },
  { icon: UsersRound, title: 'Human Practice', body: 'Perform live with partners, teams and teachers.' },
];

function AiHuman() {
  return (
    <section id="how" className="scroll-mt-28 bg-slate-50">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:mx-auto sm:text-center">
          <span className="badge bg-brand-gold/20 text-brand">The Ecosystem</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-slate-900 min-[380px]:text-2xl sm:mt-4 sm:text-3xl md:text-4xl">
            Practice with AI. Perform with Humans.
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600 sm:mx-auto sm:mt-4 sm:max-w-3xl sm:text-lg">
            A complete learning ecosystem that takes you from private practice to confident
            performance.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
          {AI_STEPS.map((s, i) => (
            <div
              key={s.title}
              className="relative flex gap-3.5 rounded-xl border border-slate-200 bg-white p-3.5 transition hover:-translate-y-1 hover:border-brand/20 hover:shadow-md sm:block sm:p-5"
            >
              <div className="relative shrink-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white sm:h-11 sm:w-11">
                  <s.icon className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />
                </div>
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-gold text-[10px] font-bold text-slate-900 sm:hidden">
                  {i + 1}
                </span>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900 sm:mt-4 sm:text-lg">{s.title}</h3>
                <p className="mt-0.5 text-sm leading-snug text-slate-600 sm:mt-1">{s.body}</p>
              </div>
              <span className="absolute right-4 top-4 hidden text-3xl font-black text-slate-100 sm:block">
                {i + 1}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-3 sm:mt-10 sm:gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-brand/20 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2.5 text-brand">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10">
                <Users size={18} />
              </div>
              <h3 className="text-base font-bold sm:text-lg">Community Practice Path</h3>
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-600 min-[400px]:grid-cols-2 sm:mt-4 sm:grid-cols-1">
              {['Speaking Partners', 'Speaking Teams', 'Weekly Activities', 'Community Access'].map(
                (x) => (
                  <li key={x} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 sm:bg-transparent sm:px-0 sm:py-0">
                    <CheckCircle2 size={15} className="shrink-0 text-brand" />
                    <span className="leading-snug">{x}</span>
                  </li>
                ),
              )}
            </ul>
          </div>
          <div className="rounded-xl border border-brand-gold/30 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2.5 text-brand">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-gold/15">
                <GraduationCap size={18} className="text-brand-gold" />
              </div>
              <h3 className="text-base font-bold sm:text-lg">Teacher Guided Path</h3>
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-600 min-[400px]:grid-cols-2 sm:mt-4 sm:grid-cols-1">
              {['Live Classes', 'Teacher Feedback', 'Accountability', 'Community Practice'].map(
                (x) => (
                  <li key={x} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 sm:bg-transparent sm:px-0 sm:py-0">
                    <CheckCircle2 size={15} className="shrink-0 text-brand-gold" />
                    <span className="leading-snug">{x}</span>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-4 rounded-2xl bg-brand px-5 py-5 text-left text-white sm:mt-10 sm:gap-5 sm:px-6 sm:py-8 sm:text-center md:flex-row md:items-center md:justify-between md:text-left md:px-10">
          <div>
            <h3 className="text-base font-bold sm:text-xl">The book is your compass</h3>
            <p className="mt-1 text-sm leading-relaxed text-white/80 sm:text-base">
              Learning Roadmap · AI Guide · Community Guide · Teacher Resource
            </p>
          </div>
          <div className="w-full rounded-xl bg-brand-gold px-4 py-2.5 text-center text-sm font-bold leading-snug text-slate-900 sm:w-auto sm:rounded-full sm:px-5 sm:text-base">
            AI Builds Fluency · Humans Build Confidence
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------- 4. Choose Your English */

const ENGLISH = [
  {
    flag: 'gb',
    region: 'United Kingdom',
    title: 'British English',
    body: 'Received Pronunciation and UK conventions.',
  },
  {
    flag: 'us',
    region: 'United States',
    title: 'American English',
    body: 'General American accent and US usage.',
  },
  {
    flag: 'intl',
    region: 'Global',
    title: 'International English',
    body: 'Neutral, globally understood communication.',
  },
] as const;

function EnglishFlagIcon({ variant }: { variant: (typeof ENGLISH)[number]['flag'] }) {
  const shell =
    'relative aspect-[3/2] h-10 shrink-0 overflow-hidden rounded-lg shadow-md ring-1 ring-black/5 md:mx-auto md:h-16 md:rounded-xl';

  if (variant === 'intl') {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-brand/15 to-sky-100/80 ${shell}`}
        aria-hidden
      >
        <Globe className="h-5 w-5 text-brand md:h-7 md:w-7" strokeWidth={1.75} />
      </div>
    );
  }

  const svgClass = 'absolute inset-0 block h-full w-full';

  if (variant === 'gb') {
    return (
      <div className={shell} aria-hidden>
        <svg className={svgClass} viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice">
          <clipPath id="se-gb-s">
            <path d="M0,0 v30 h60 v-30 z" />
          </clipPath>
          <clipPath id="se-gb-t">
            <path d="M30,15 h30 v15 z v15 h-30 z h-30 z h-30 z v-15 z v-15 h30 z" />
          </clipPath>
          <g clipPath="url(#se-gb-s)">
            <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
            <path d="M0,0 60,30 M60,0 0,30" stroke="#fff" strokeWidth="6" />
            <path d="M0,0 60,30 M60,0 0,30" clipPath="url(#se-gb-t)" stroke="#C8102E" strokeWidth="4" />
            <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
            <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
          </g>
        </svg>
      </div>
    );
  }

  return (
    <div className={shell} aria-hidden>
      <svg className={svgClass} viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice">
        <rect width="60" height="30" fill="#B22234" />
        <path
          stroke="#fff"
          strokeWidth="2.308"
          d="M0,2.308H60M0,6.923H60M0,11.538H60M0,16.154H60M0,20.769H60M0,25.385H60"
        />
        <rect width="24" height="16.154" fill="#3C3B6E" />
        <g fill="#fff">
          <circle cx="4" cy="2.8" r="0.85" />
          <circle cx="8" cy="2.8" r="0.85" />
          <circle cx="12" cy="2.8" r="0.85" />
          <circle cx="16" cy="2.8" r="0.85" />
          <circle cx="20" cy="2.8" r="0.85" />
          <circle cx="6" cy="5.6" r="0.85" />
          <circle cx="10" cy="5.6" r="0.85" />
          <circle cx="14" cy="5.6" r="0.85" />
          <circle cx="18" cy="5.6" r="0.85" />
          <circle cx="4" cy="8.4" r="0.85" />
          <circle cx="8" cy="8.4" r="0.85" />
          <circle cx="12" cy="8.4" r="0.85" />
          <circle cx="16" cy="8.4" r="0.85" />
          <circle cx="20" cy="8.4" r="0.85" />
          <circle cx="6" cy="11.2" r="0.85" />
          <circle cx="10" cy="11.2" r="0.85" />
          <circle cx="14" cy="11.2" r="0.85" />
          <circle cx="18" cy="11.2" r="0.85" />
          <circle cx="4" cy="14" r="0.85" />
          <circle cx="8" cy="14" r="0.85" />
          <circle cx="12" cy="14" r="0.85" />
          <circle cx="16" cy="14" r="0.85" />
          <circle cx="20" cy="14" r="0.85" />
        </g>
      </svg>
    </div>
  );
}

const SKILLS = [
  'Conversation',
  'GD',
  'Interviews',
  'IELTS',
  'Public Speaking',
  'Storytelling',
  'Debate',
];

function ChooseEnglish() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:mx-auto sm:text-center">
          <span className="badge bg-brand-gold/20 text-brand">Personalize</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-slate-900 min-[380px]:text-2xl sm:mt-4 sm:text-3xl md:text-4xl">
            Choose Your English
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600 sm:mx-auto sm:mt-4 sm:max-w-3xl sm:text-lg">
            One book, three English versions — learn the variety that fits your goals.
          </p>
        </div>

        <div className="mt-6 grid gap-3 md:mt-12 md:grid-cols-3 md:gap-5">
          {ENGLISH.map((e) => (
            <div
              key={e.title}
              className="group relative flex cursor-pointer items-center gap-4 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-lg hover:shadow-brand/5 md:flex-col md:items-center md:p-6 md:text-center"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/[0.04] via-transparent to-brand-gold/[0.03] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
              <EnglishFlagIcon variant={e.flag} />
              <div className="relative min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {e.region}
                </p>
                <h3 className="mt-0.5 text-base font-bold text-slate-900 transition-colors group-hover:text-brand md:mt-2 md:text-xl">
                  {e.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{e.body}</p>
              </div>
              <ArrowRight
                size={18}
                className="relative shrink-0 text-slate-300 transition duration-300 group-hover:translate-x-0.5 group-hover:text-brand md:hidden"
                aria-hidden
              />
            </div>
          ))}
        </div>

        <p className="mt-6 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:mt-10 sm:text-center">
          Skills you can master
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-center sm:gap-3">
          {SKILLS.map((s) => (
            <span
              key={s}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-700 sm:rounded-full sm:px-3.5 sm:py-2 sm:text-sm"
            >
              {s}
            </span>
          ))}
        </div>

        <p className="mt-6 text-left text-base font-semibold text-brand sm:mt-8 sm:text-center sm:text-lg">
          One Book · Three English Versions
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------- 5. Choose Your Journey */

/** Adults and kids learn the same core skills — only the topics differ. */
const COMMON_SKILLS = [
  'Conversation',
  'Group Discussion',
  'IELTS Speaking',
  'Public Speaking & Presentation',
  'Storytelling',
  'Debate',
];

const JOURNEYS = [
  {
    icon: UsersRound,
    title: 'Adults',
    audience: 'Students · Professionals · Job Seekers',
    skills: COMMON_SKILLS,
    extra: 'Job Interview',
    outcomes: 'Topics and practice situations designed for adult learners.',
  },
  {
    icon: Sparkles,
    title: 'Kids',
    audience: 'Young Learners Building Communication Skills',
    skills: COMMON_SKILLS,
    extra: null,
    outcomes: "Topics and activities designed according to the learner's age.",
  },
];

function ChooseJourney() {
  return (
    <section className="bg-slate-50">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:mx-auto sm:text-center">
          <span className="badge bg-brand-gold/20 text-brand">Your Path</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-slate-900 min-[380px]:text-2xl sm:mt-4 sm:text-3xl md:text-4xl">
            Choose Your SpeakEdge Journey
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600 sm:mx-auto sm:mt-4 sm:max-w-3xl sm:text-lg">
            Same Skills. Age-Appropriate Topics.
          </p>
        </div>
        <div className="mt-6 grid gap-3 sm:mt-12 sm:gap-6 md:grid-cols-2">
          {JOURNEYS.map((j) => (
            <div
              key={j.title}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand sm:h-12 sm:w-12 sm:rounded-xl">
                  <j.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-slate-900 sm:text-2xl">{j.title}</h3>
                  <p className="text-xs font-medium text-slate-500 sm:text-sm">{j.audience}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-4">
                {j.skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 sm:rounded-lg sm:px-2.5 sm:text-xs"
                  >
                    {s}
                  </span>
                ))}
              </div>
              {j.extra && (
                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-600 sm:text-sm">
                  <span className="font-semibold text-slate-700">Additional for adults:</span>
                  <span className="rounded-md border border-brand-gold/40 bg-brand-gold/10 px-2 py-1 text-[11px] font-semibold text-brand sm:rounded-lg sm:px-2.5 sm:text-xs">
                    {j.extra}
                  </span>
                </p>
              )}
              <p className="mt-3 rounded-lg bg-brand/5 px-2.5 py-2 text-xs leading-snug text-brand sm:mt-4 sm:px-3 sm:text-sm">
                {j.outcomes}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------- 6. Become a SpeakEdge Member */

const MEMBERSHIP_INCLUDES = [
  { icon: BadgeCheck, label: 'Membership' },
  { icon: BookOpen, label: 'SpeakEdge Book' },
  { icon: Bot, label: 'AI Practice' },
  { icon: Users, label: 'Speaking Community' },
  { icon: CalendarClock, label: 'Live Learning' },
  { icon: Award, label: 'CEFR Assessment' },
  { icon: Mic, label: 'Speaking Practice' },
  { icon: Trophy, label: 'Certification' },
];

function Membership() {
  const lowestAdmission = useLowestAdmissionPrice();
  return (
    <section id="membership" className="scroll-mt-28 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="overflow-hidden rounded-2xl border border-brand/15 bg-gradient-to-br from-brand to-brand-light text-white sm:rounded-3xl">
          <div className="grid gap-5 p-4 sm:gap-10 sm:p-8 md:grid-cols-2 md:p-12">
            <div>
              <span className="badge bg-white/15 text-white">Become a SpeakEdge Member</span>
              <div className="mt-4 sm:mt-6">
                <p className="text-2xl font-black leading-tight tracking-tight sm:text-4xl">
                  Membership Starts at{' '}
                  {lowestAdmission != null && (
                    <span className="text-brand-gold">{planRupees(lowestAdmission)}</span>
                  )}
                </p>
              </div>
              <p className="mt-2 text-sm leading-snug text-white/80 sm:mt-4 sm:max-w-md sm:text-base">
                Choose the membership that suits your learning needs and become part of the complete
                SpeakEdge English communication ecosystem.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-8 sm:flex sm:flex-wrap sm:gap-3">
                <Link
                  to="/plans"
                  className="btn-gold min-h-[40px] py-2.5 text-sm sm:min-h-[44px] sm:w-auto sm:py-2 sm:text-base"
                >
                  Explore Membership
                </Link>
                <Link
                  to="/demo"
                  className="btn min-h-[40px] bg-white py-2.5 text-sm text-brand hover:bg-white/90 sm:min-h-[44px] sm:w-auto sm:py-2 sm:text-base"
                >
                  Free Demo
                </Link>
              </div>
            </div>
            <div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-2 sm:gap-3">
                {MEMBERSHIP_INCLUDES.map((m) => (
                  <div
                    key={m.label}
                    className="flex flex-col items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-1.5 py-2 text-center backdrop-blur sm:flex-row sm:items-center sm:gap-2 sm:rounded-xl sm:px-4 sm:py-3 sm:text-left"
                  >
                    <m.icon className="h-4 w-4 shrink-0 text-brand-gold sm:h-[18px] sm:w-[18px]" />
                    <span className="text-[9px] font-medium leading-tight sm:text-sm">{m.label}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-white/70 sm:mt-4 sm:text-sm">
                Features and access vary according to the selected membership plan.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- 7. Book Showcase */

const BOOK_UNLOCKS = [
  'Structured Learning',
  'AI Practice Guide',
  'Communication Activities',
  'SpeakEdge Journey Guide',
];

function BookShowcase() {
  return (
    <section id="book" className="scroll-mt-28 bg-slate-50">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="grid items-center gap-5 sm:gap-10 md:grid-cols-2 md:gap-12">
          <div className="flex items-center gap-5 py-3 pl-4 sm:gap-6 sm:py-5 sm:pl-6 md:justify-center md:py-8 md:pl-10">
            <div className="book-3d" aria-hidden="true">
              <div className="book-3d-ambient" />
              <div className="book-3d-glow" />
              <div className="book-3d-scene">
                <div className="book-3d-cover">
                  <img
                    src={bookCoverUrl}
                    alt=""
                    draggable={false}
                    loading="eager"
                    decoding="async"
                  />
                  <div className="book-3d-cover-shine" />
                </div>
                <div className="book-3d-cover-lip" />
                <div className="book-3d-spine">
                  <span>SpeakEdge</span>
                </div>
                <div className="book-3d-pages" />
                <div className="book-3d-fore" />
                <div className="book-3d-top" />
                <div className="book-3d-bottom" />
                <div className="book-3d-back" />
              </div>
              <div className="book-3d-platform" />
              <div className="book-3d-shadow" />
            </div>
            <div className="min-w-0 md:hidden">
              <span className="badge bg-brand-gold/20 text-brand">Book Showcase</span>
              <h2 className="mt-2 text-balance text-lg font-extrabold leading-tight text-slate-900 min-[380px]:text-xl">
                Your Guide to the SpeakEdge Journey
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Your structured learning and practice guide through the SpeakEdge ecosystem.
              </p>
            </div>
          </div>
          <div>
            <div className="hidden md:block">
              <SectionHeading
                align="left"
                eyebrow="Book Showcase"
                title="Your Guide to the SpeakEdge Journey"
                subtitle={
                  <>
                    The SpeakEdge Book is your structured learning and practice guide, designed to
                    support your journey through the SpeakEdge ecosystem.
                  </>
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:mt-8 sm:gap-3 md:mt-6">
              {BOOK_UNLOCKS.map((b) => (
                <div
                  key={b}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-medium sm:gap-2 sm:px-4 sm:py-3 sm:text-sm"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand sm:h-4 sm:w-4" /> {b}
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-brand-gold/30 bg-brand-gold/[0.08] px-3 py-2.5 text-[11px] leading-snug text-slate-700 sm:mt-4 sm:text-sm">
              <Key size={15} className="mt-0.5 shrink-0 text-brand-gold" />
              <span>
                Includes a unique <strong className="font-semibold">Activation Code</strong> for
                activating your SpeakEdge access after membership enrolment.
              </span>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3">
              <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3 sm:block sm:p-5 sm:text-center">
                <Building2 className="shrink-0 text-brand sm:mx-auto" size={18} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold sm:mt-2 sm:text-sm">Office Collection</div>
                  <div className="text-[10px] text-slate-500 sm:text-xs">Pick up at centre</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3 sm:block sm:p-5 sm:text-center">
                <Home className="shrink-0 text-brand sm:mx-auto" size={18} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold sm:mt-2 sm:text-sm">Home Delivery</div>
                  <div className="text-[10px] text-slate-500 sm:text-xs">Shipped to door</div>
                </div>
              </div>
            </div>
            <Link
              to="/plans"
              className="btn-primary mt-4 min-h-[40px] w-full py-2.5 text-sm sm:mt-6 sm:min-h-[44px] sm:w-auto sm:py-2 sm:text-base"
            >
              Buy Now <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------- 8. Why the Book Differs */

const BOOK_FEATURES = [
  { icon: Languages, title: '1500+ Collocations', body: 'Natural word combinations native speakers use.' },
  { icon: BookOpen, title: 'Vocabulary', body: 'High-frequency words for real communication.' },
  { icon: ScrollText, title: 'Grammar Patterns', body: 'Patterns you internalize, not rules you cram.' },
  { icon: Ear, title: 'Pronunciation', body: 'Clear, confident sounds and intonation.' },
  { icon: MessageSquare, title: 'Communication Skills', body: 'Beyond language — real-world speaking.' },
];

function WhyBook() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:hidden">
          <span className="badge bg-brand-gold/20 text-brand">More Than a Book</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-slate-900 min-[380px]:text-2xl">
            Why the SpeakEdge Book is Different
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            Designed for practical English learning and communication — not just grammar study.
          </p>
        </div>
        <div className="hidden sm:block">
          <SectionHeading
            eyebrow="More Than a Book"
            title="Why the SpeakEdge Book is Different"
            subtitle="Designed for practical English learning and communication — not just grammar study."
          />
        </div>

        <div className="mt-6 sm:hidden">
          <div className="flex items-center gap-3.5 rounded-xl border border-brand/15 bg-gradient-to-r from-brand/[0.04] to-brand-gold/[0.06] p-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-light text-white shadow-md">
              <BookOpen size={22} className="text-brand-gold" />
            </div>
            <p className="text-sm font-semibold leading-snug text-slate-800">
              Five pillars of real-world communication — built into one book.
            </p>
          </div>
          <div className="mt-3 grid gap-2.5">
            {BOOK_FEATURES.map((f) => (
              <FeatureRow key={f.title} compact {...f} />
            ))}
          </div>
        </div>

        <div className="mt-10 hidden items-center gap-5 sm:mt-12 sm:grid sm:gap-6 lg:grid-cols-[1fr_auto_1fr]">
          <div className="order-2 grid gap-3 sm:gap-4 lg:order-1">
            {BOOK_FEATURES.slice(0, 3).map((f) => (
              <FeatureRow key={f.title} {...f} />
            ))}
          </div>
          <div className="order-1 flex justify-center lg:order-2">
            <div className="flex h-32 w-32 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-light text-white shadow-xl sm:h-40 sm:w-40">
              <BookOpen size={40} className="text-brand-gold" />
              <span className="mt-2 text-xs font-bold sm:text-sm">More Than a Book</span>
            </div>
          </div>
          <div className="order-3 grid gap-3 sm:gap-4">
            {BOOK_FEATURES.slice(3).map((f) => (
              <FeatureRow key={f.title} {...f} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  body,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">{title}</div>
          <div className="mt-0.5 text-xs leading-snug text-slate-600">{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon size={20} />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-slate-600">{body}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------- 9. More Than Fluency */

const TRADITIONAL_COMPARE = [
  'Grammar drills & memorization',
  'Passive video lessons',
  'No real speaking practice',
  'No community or accountability',
  'Language only — not communication',
];

const COMPARE = [
  'Fluency',
  'Communication',
  'Confidence',
  'Conversation',
  'Group Discussion (GD)',
  'Presentation',
  'Public Speaking',
  'Interview',
  'Storytelling',
  'Debate',
];

function MoreThanFluency() {
  return (
    <section className="bg-slate-50">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:hidden">
          <span className="badge bg-brand-gold/20 text-brand">More Than Fluency</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-slate-900 min-[380px]:text-2xl">
            We build communicators, not just speakers
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            See how SpeakEdge goes beyond ordinary English platforms.
          </p>
        </div>
        <div className="hidden sm:block">
          <SectionHeading
            eyebrow="More Than Fluency"
            title="We build communicators, not just speakers"
            subtitle="See how SpeakEdge goes beyond ordinary English platforms."
          />
        </div>

        <div className="mt-6 space-y-3 sm:hidden">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                Traditional Platform
              </h3>
            </div>
            <ul className="divide-y divide-slate-100">
              {TRADITIONAL_COMPARE.map((item) => (
                <li key={item} className="flex items-start gap-2.5 px-4 py-3 text-sm text-slate-500">
                  <X size={15} className="mt-0.5 shrink-0 text-slate-300" strokeWidth={2.5} />
                  <span className="leading-snug">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-hidden rounded-xl border-2 border-brand bg-white shadow-sm">
            <div className="border-b border-brand/10 bg-brand/5 px-4 py-2.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand">
                SpeakEdge
              </h3>
            </div>
            <ul className="divide-y divide-brand/10">
              {COMPARE.map((c) => (
                <li key={c} className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-slate-700">
                  <CheckCircle2 size={15} className="shrink-0 text-brand" strokeWidth={2.25} />
                  <span className="leading-snug">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 hidden gap-6 sm:grid md:grid-cols-2">
          <div className="card border-slate-200">
            <h3 className="text-lg font-bold text-slate-500">Traditional Platform</h3>
            <ul className="mt-4 space-y-2 text-sm text-slate-500">
              {TRADITIONAL_COMPARE.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="card border-2 border-brand bg-brand/5">
            <h3 className="text-lg font-bold text-brand">SpeakEdge</h3>
            <ul className="mt-4 grid grid-cols-1 gap-2 text-sm text-slate-700 min-[420px]:grid-cols-2">
              {COMPARE.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0 text-brand" /> {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------- 10. 20 Minutes a Day */

const TWENTY_STEPS = [
  { icon: BadgeCheck, label: 'Membership', desc: 'Choose your plan' },
  { icon: BookOpen, label: 'Book & Learning', desc: 'Read & absorb' },
  { icon: Bot, label: 'AI Practice', desc: 'Rehearse anytime' },
  { icon: UsersRound, label: 'Human Practice', desc: 'Perform live' },
  { icon: Sparkles, label: 'Confidence', desc: 'Compound daily' },
] as const;

function TwentyMinutes() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-brand via-brand to-brand-light text-white">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-gold/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-white/10 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-4 py-12 sm:py-16 md:py-24">
        <SectionHeading
          light
          eyebrow="The Habit"
          title="Spend Only 20 Minutes a Day"
          subtitle="A small daily habit compounds into lasting confidence."
        />

        {/* 20-min hero stat */}
        <div className="mt-10 flex justify-center md:mt-14">
          <div className="relative flex h-28 w-28 flex-col items-center justify-center rounded-full bg-brand-gold font-black text-slate-900 shadow-xl shadow-brand-gold/25 ring-4 ring-white/20 sm:h-32 sm:w-32">
            <span className="text-3xl leading-none sm:text-4xl">20</span>
            <span className="mt-1 text-[10px] uppercase tracking-widest sm:text-xs">min / day</span>
          </div>
        </div>

        {/* Mobile: vertical timeline */}
        <ol className="mx-auto mt-8 max-w-sm md:hidden">
          {TWENTY_STEPS.map((step, i) => (
            <li key={step.label} className="relative flex gap-4 pb-5 last:pb-0">
              {i < TWENTY_STEPS.length - 1 && (
                <div
                  aria-hidden
                  className="absolute left-[19px] top-10 h-[calc(100%-0.75rem)] w-px bg-gradient-to-b from-brand-gold/70 to-white/20"
                />
              )}
              <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-brand-gold/60 bg-brand-gold/15">
                <step.icon size={18} className="text-brand-gold" />
              </div>
              <div className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <div className="text-sm font-bold">{step.label}</div>
                <div className="text-xs text-white/65">{step.desc}</div>
              </div>
            </li>
          ))}
        </ol>

        {/* Desktop: horizontal flow */}
        <div className="mt-12 hidden flex-wrap items-center justify-center gap-2 md:flex lg:gap-3">
          {TWENTY_STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-2 lg:gap-3">
              {i > 0 && <ArrowRight className="shrink-0 text-brand-gold" size={20} />}
              <div className="w-32 rounded-2xl border border-white/15 bg-white/10 p-4 text-center backdrop-blur-sm transition hover:bg-white/15 lg:w-36">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand-gold/20">
                  <step.icon size={20} className="text-brand-gold" />
                </div>
                <div className="mt-3 text-sm font-bold">{step.label}</div>
                <div className="mt-0.5 text-xs text-white/65">{step.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:mx-auto sm:max-w-xs sm:flex-row sm:justify-center md:mt-12 md:max-w-none">
          <Link to="/plans" className="btn-gold w-full py-3.5 text-center sm:w-auto sm:py-2">
            Explore Membership
          </Link>
          <Link
            to="/demo"
            className="btn w-full bg-white py-3.5 text-center text-brand hover:bg-white/90 sm:w-auto sm:py-2"
          >
            Free Demo
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------ 11. Speaking Community */

const COMMUNITY = [
  { icon: Users, label: 'Speaking Partners' },
  { icon: UsersRound, label: 'Speaking Teams' },
  { icon: CalendarClock, label: 'Weekly Activities' },
  { icon: MessageSquare, label: 'Friend Requests' },
  { icon: BadgeCheck, label: 'Community Profiles' },
  { icon: Star, label: 'Member Carousel' },
];

function Community() {
  return (
    <section id="community" className="scroll-mt-28 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:hidden">
          <span className="badge bg-brand-gold/20 text-brand">Speaking Community</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-slate-900 min-[380px]:text-2xl">
            The SpeakEdge Speaking Community
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            Connect with members, find speaking partners, join teams and practise English through
            regular community interaction.
          </p>
        </div>
        <div className="hidden sm:block">
          <SectionHeading
            eyebrow="Speaking Community"
            title="The SpeakEdge Speaking Community"
            subtitle="Connect with members, find speaking partners, join teams and practise English through regular community interaction."
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:hidden">
          {COMMUNITY.map((c) => (
            <div
              key={c.label}
              className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-3.5 text-center"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <c.icon size={18} />
              </div>
              <span className="text-xs font-semibold leading-tight text-slate-900">{c.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 hidden gap-4 sm:mt-12 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {COMMUNITY.map((c) => (
            <div
              key={c.label}
              className="card flex items-center gap-3 p-4 transition hover:shadow-md sm:p-5"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <c.icon size={20} />
              </div>
              <span className="font-semibold">{c.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center sm:mt-10">
          <Link
            to="/login"
            className="btn-primary flex min-h-[44px] w-full items-center justify-center gap-2 py-3 text-sm sm:inline-flex sm:w-auto sm:py-2 sm:text-base"
          >
            Explore Community <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------- 12. CEFR Certification */

const CEFR = [
  { icon: Target, title: 'CEFR Test', body: 'Assess your CEFR level.' },
  { icon: ScrollText, title: 'Report Card', body: 'Detailed skill breakdown.' },
  { icon: ShieldCheck, title: 'Verified Badge', body: 'Examiner-verified proof.' },
  { icon: Award, title: 'Certificate', body: 'Shareable & online-verifiable.' },
];

function Cefr() {
  return (
    <section className="bg-slate-50">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:hidden">
          <span className="badge bg-brand-gold/20 text-brand">Credibility</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-slate-900 min-[380px]:text-2xl">
            CEFR Assessment & Certification
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            Measurable outcomes you can prove — and share.
          </p>
        </div>
        <div className="hidden sm:block">
          <SectionHeading
            eyebrow="Credibility"
            title="CEFR Assessment & Certification"
            subtitle="Measurable outcomes you can prove — and share."
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:hidden">
          {CEFR.map((c) => (
            <div
              key={c.title}
              className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3.5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                <c.icon size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-bold leading-tight text-slate-900 min-[380px]:text-sm">
                  {c.title}
                </h3>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-600 min-[380px]:text-xs">
                  {c.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 hidden flex-col items-stretch gap-3 sm:flex md:flex-row md:items-center">
          {CEFR.map((c, i) => (
            <div key={c.title} className="flex flex-1 items-center gap-3 md:flex-col">
              <div className="card w-full text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-brand text-white">
                  <c.icon size={22} />
                </div>
                <h3 className="mt-3 font-bold">{c.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{c.body}</p>
              </div>
              {i < CEFR.length - 1 && (
                <ArrowRight className="rotate-90 shrink-0 text-brand-gold md:rotate-0" size={20} />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------- 13. Membership Plans */

/**
 * Representative plans shown on the home page — Basic and Pro tiers live on
 * /plans. Prices come from the live catalogue; the monthly fee leads, the
 * one-time fee sits under it.
 */
const HOME_PLANS = [
  {
    name: 'Tribe',
    benefits: [
      'SpeakEdge Book Included',
      'Speaking Community Access: 1 Year',
      'Unlimited Individual Speaking Partners',
      'AI-Guided Learning',
    ],
  },
  {
    name: 'Silver',
    benefits: [
      'SpeakEdge Book Included',
      'Speaking Community Access: 1 Year',
      'Conversation Teams + Unlimited Individual Speaking Partners',
      '1 Teacher-led Class/Week',
      'CEFR & Speaking Assessments',
    ],
  },
  {
    name: 'Gold',
    benefits: [
      'SpeakEdge Book Included',
      'Speaking Community Access: 3 Years',
      'Conversation Teams + Unlimited Individual Speaking Partners',
      '1 Teacher-led Class/Week',
      'More CEFR & Speaking Assessments',
      'Extended Support',
    ],
  },
  {
    name: 'Diamond',
    benefits: [
      'SpeakEdge Book Included',
      'Speaking Community Access: 5 Years',
      '2 Conversation Teams + Unlimited Individual Speaking Partners',
      '1 Teacher-led Class/Week',
      '4 CEFR Tests',
      '4 Speaking Tests',
      'Student Relation Support: 5 Years',
    ],
  },
] as const;

function homeCardPrice(cfg: PlanPrice | undefined, name: string) {
  if (!cfg) return { headline: '', headlineNote: '', secondary: '', monthly: false };
  const monthly = cfg.monthly_fee > 0;
  const admission = planRupees(admissionOf(cfg));
  if (monthly) {
    return {
      headline: planRupees(cfg.monthly_fee),
      headlineNote: 'per month',
      secondary: `${admission} One-Time Admission Fee`,
      monthly: true,
    };
  }
  return {
    headline: admission,
    headlineNote: name === 'Tribe' ? 'One-Time Membership Fee' : 'One-Time Admission Fee',
    secondary: 'No Monthly Fee',
    monthly: false,
  };
}

function MembershipPlans() {
  const { data: catalogue } = usePublicPlans();
  return (
    <section id="plans" className="scroll-mt-28 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:hidden">
          <span className="badge bg-brand-gold/20 text-brand">Membership</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-slate-900 min-[380px]:text-2xl">
            Choose Your SpeakEdge Membership
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Every membership includes AI-guided learning based on the SpeakEdge Book. Choose the
            level of live learning, practice, assessment and support that suits you.
          </p>
        </div>
        <div className="hidden sm:block">
          <SectionHeading
            eyebrow="Membership"
            title="Choose Your SpeakEdge Membership"
            subtitle="Every membership includes AI-guided learning based on the SpeakEdge Book. Choose the level of live learning, practice, assessment and support that suits you."
          />
        </div>

        <div className="mt-6 grid gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
          {HOME_PLANS.map((p) => {
            const { headline, headlineNote, secondary, monthly } = homeCardPrice(
              catalogue?.find((c) => c.plan === p.name),
              p.name,
            );
            return (
              <div
                key={p.name}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-md sm:p-5"
              >
                <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-brand">{p.name}</h3>

                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-3xl font-black leading-none tracking-tight text-slate-900 sm:text-4xl">
                    {headline}
                  </span>
                  {headline && (
                    <span className="text-xs font-medium text-slate-500">{headlineNote}</span>
                  )}
                </div>
                <p
                  className={`mt-1.5 text-xs font-semibold ${
                    monthly ? 'text-slate-600' : 'text-brand'
                  }`}
                >
                  {secondary}
                </p>

                <ul className="mt-4 flex-1 space-y-2 border-t border-slate-100 pt-4 text-xs leading-snug text-slate-600 sm:text-sm">
                  {p.benefits.map((b) => (
                    <li key={b} className="flex gap-2">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-brand" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="mt-6 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm leading-relaxed text-slate-600 sm:mt-8 sm:p-5 sm:text-center">
          <p>
            <span className="font-semibold text-slate-800">Need more teacher-led learning?</span> Pro
            plans include 2 Teacher-led Classes per Week.
          </p>
          <p>
            Start at your level. Upgrade when you&apos;re ready — your eligible previous
            membership/admission fee is adjusted on upgrade.
          </p>
        </div>

        <div className="mt-6 text-center sm:mt-8">
          <Link
            to="/plans"
            className="btn-primary flex min-h-[44px] w-full items-center justify-center gap-2 py-3 text-sm sm:inline-flex sm:w-auto sm:py-2 sm:text-base"
          >
            View All Membership Plans <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------ 14. Success Statistics */

function SuccessStats() {
  return (
    <section className="bg-gradient-to-br from-brand to-brand-light text-white">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-4 sm:py-16 md:py-24">
        <div className="max-w-3xl text-left sm:hidden">
          <span className="badge bg-white/15 text-white">Trusted</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight text-white min-[380px]:text-2xl">
            An Educational Legacy Meets Modern Innovation
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/80">
            Built on the educational experience and legacy of Sujyoti Language School, established in
            2009, and strengthened by modern AI-powered learning.
          </p>
        </div>
        <div className="hidden sm:block">
          <SectionHeading
            light
            eyebrow="Trusted"
            title="An Educational Legacy Meets Modern Innovation"
            subtitle="Built on the educational experience and legacy of Sujyoti Language School, established in 2009, and strengthened by modern AI-powered learning."
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-12 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
          <BigStat count={20000} suffix="+" label="Fluent English Speakers" />
          <BigStat value="2009" label="Educational Legacy Since" />
          <BigStat value="A1–C2" label="CEFR-Aligned Learning" />
          <BigStat value="AI + Human" label="Learning Ecosystem" />
        </div>

        {/* Attribution is mandatory wherever 20,000+ / 2009 appear. */}
        <p className="mt-4 text-left text-[11px] leading-relaxed text-white/65 sm:mt-6 sm:text-center sm:text-sm">
          The 20,000+ learners and the legacy since 2009 belong to Sujyoti Language School. SpeakEdge
          is a product of Sujyoti EdTech Pvt. Ltd.
        </p>
      </div>
    </section>
  );
}

function BigStat({
  value,
  count,
  suffix,
  label,
}: {
  /** Static text value — used when there is nothing to count up to. */
  value?: string;
  /** Numeric value animated by the counter. */
  count?: number;
  suffix?: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 p-3.5 text-center backdrop-blur sm:rounded-2xl sm:p-6">
      <div className="text-xl font-black text-brand-gold min-[380px]:text-2xl sm:text-3xl md:text-4xl">
        {count != null ? <Counter target={count} suffix={suffix} /> : value}
      </div>
      <div className="mt-1 text-[10px] font-medium leading-tight text-white/80 min-[380px]:text-[11px] sm:mt-2 sm:text-sm sm:font-normal">
        {label}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- 15. Final CTA */

function FinalCta() {
  return (
    <section className="bg-slate-900 text-white">
      <div className="mx-auto max-w-4xl px-5 py-10 sm:px-4 sm:py-20 md:py-28">
        <div className="text-left sm:hidden">
          <span className="badge bg-brand-gold/20 text-brand-gold">Our Promise</span>
          <h2 className="mt-3 text-balance text-xl font-extrabold leading-tight min-[380px]:text-2xl">
            We don&apos;t just teach English.{' '}
            <span className="text-brand-gold">We build confident communicators.</span>
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            Choose your membership. Learn with the SpeakEdge Book. Practice with AI. Perform with
            Humans.
          </p>
          <div className="mt-6">
            <Link
              to="/plans"
              className="btn-gold flex min-h-[44px] w-full items-center justify-center py-3 text-sm"
            >
              View Memberships
            </Link>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link
                to="/demo"
                className="btn flex min-h-[44px] items-center justify-center bg-white py-3 text-xs font-semibold text-slate-900 hover:bg-white/90"
              >
                Free Demo
              </Link>
              <Link
                to="/activate"
                className="btn flex min-h-[44px] items-center justify-center border border-brand-gold/60 bg-brand-gold/10 py-3 text-xs font-bold text-brand-gold hover:bg-brand-gold/20"
              >
                Activate Membership
              </Link>
            </div>
          </div>
        </div>

        <div className="hidden text-center sm:block">
          <span className="badge bg-brand-gold/20 text-brand-gold">Our Promise</span>
          <h2 className="mt-5 text-balance text-2xl font-extrabold leading-tight sm:mt-6 sm:text-3xl md:text-5xl">
            We don&apos;t just teach English.
            <br />
            We build <span className="text-brand-gold">confident communicators.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-white/70 sm:mt-5 sm:text-lg">
            Choose your membership. Learn with the SpeakEdge Book. Practice with AI. Perform with
            Humans.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:justify-center">
            <Link to="/plans" className="btn-gold min-h-[44px] w-full py-3 sm:w-auto sm:py-2">
              View Memberships
            </Link>
            <Link
              to="/demo"
              className="btn min-h-[44px] w-full bg-white py-3 text-slate-900 hover:bg-white/90 sm:w-auto sm:py-2"
            >
              Free Demo
            </Link>
            <Link
              to="/activate"
              className="btn min-h-[44px] w-full border border-brand-gold/60 bg-brand-gold/10 py-3 font-bold text-brand-gold hover:bg-brand-gold/20 sm:w-auto sm:py-2"
            >
              Activate Membership
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- page */

export function HomePage() {
  return (
    <div className="overflow-x-hidden">
      <Hero />
      <NrpMethod />
      <AiHuman />
      <ChooseEnglish />
      <ChooseJourney />
      <Membership />
      <BookShowcase />
      <WhyBook />
      <MoreThanFluency />
      <TwentyMinutes />
      <Community />
      <Cefr />
      <MembershipPlans />
      <SuccessStats />
      <FinalCta />
    </div>
  );
}
