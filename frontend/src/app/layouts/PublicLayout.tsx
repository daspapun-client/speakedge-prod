import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Facebook, Instagram, Linkedin, MapPin, Menu, Twitter, X, Youtube,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { CONTACT_PHONE, WHATSAPP_URL, activeSocialLinks, type SocialLink } from '@/lib/site';

const SOCIAL_ICON: Record<SocialLink['key'], LucideIcon> = {
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  linkedin: Linkedin,
  x: Twitter,
  gmb: MapPin,
};

const HOME_HASH = /^\/#([\w-]+)$/;

function homeSectionId(to: string): string | null {
  return HOME_HASH.exec(to)?.[1] ?? null;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function useScrollToHash() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (pathname !== '/' || !hash) return;
    const id = hash.slice(1);
    requestAnimationFrame(() => scrollToSection(id));
  }, [pathname, hash]);
}

function HomeHashLink({
  to,
  className,
  children,
  onClick,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sectionId = homeSectionId(to);

  if (!sectionId) {
    return (
      <Link to={to} className={className} onClick={onClick}>
        {children}
      </Link>
    );
  }

  return (
    <a
      href={`/#${sectionId}`}
      className={className}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        onClick?.();
        if (pathname !== '/') {
          navigate({ pathname: '/', hash: sectionId });
          return;
        }
        scrollToSection(sectionId);
        window.history.replaceState(null, '', `#${sectionId}`);
      }}
    >
      {children}
    </a>
  );
}

const NAV: { label: string; to: string }[] = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/#about' },
  { label: 'Membership', to: '/#membership' },
  { label: 'Book', to: '/#book' },
  { label: 'Membership Plans', to: '/plans' },
  { label: 'Speaking Community', to: '/#community' },
  { label: 'Free Demo', to: '/demo' },
  { label: 'Partner', to: '/partners' },
  { label: 'Teacher', to: '/teachers' },
  { label: 'Contact', to: '/#contact' },
];

/** Social + Google Business icons. Renders nothing until URLs are configured. */
function SocialIcons() {
  const links = activeSocialLinks();
  if (!links.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {links.map((s) => {
        const Icon = SOCIAL_ICON[s.key];
        return (
          <a
            key={s.key}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={s.label}
            title={s.label}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-brand hover:bg-brand hover:text-white"
          >
            <Icon size={18} />
          </a>
        );
      })}
    </div>
  );
}

export function PublicLayout() {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const isHome = pathname === '/';
  useScrollToHash();

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div className="min-h-screen bg-surface">
      {/* Announcement bar */}
      <div className="bg-brand text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-4 py-2.5 text-center text-xs sm:gap-x-3 sm:text-sm">
          <span className="font-medium leading-snug">
            <span className="sm:hidden">One Book · One Membership · One Journey</span>
            <span className="hidden sm:inline">One Book · One Membership · One Learning Journey</span>
          </span>
          <span className="hidden text-white/40 sm:inline">•</span>
          <span className="rounded-full bg-brand-gold px-2.5 py-0.5 text-[11px] font-bold text-slate-900">
            Membership Starts at ₹699
          </span>
          <Link
            to="/plans"
            className="inline-flex min-h-[36px] items-center gap-1 font-semibold underline-offset-2 hover:underline"
          >
            Get Started <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {/* Sticky navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:py-3">
          <Link to="/" aria-label="SpeakEdge home" className="shrink-0">
            <Logo size="md" />
          </Link>
          <div className="hidden items-center gap-5 text-sm font-medium text-slate-600 lg:flex">
            {NAV.map((n) => (
              <HomeHashLink key={n.label} to={n.to} className="whitespace-nowrap hover:text-brand">
                {n.label}
              </HomeHashLink>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated() ? (
              <Link to="/dashboard" className="btn-primary hidden min-h-[40px] sm:inline-flex">
                Dashboard
              </Link>
            ) : (
              <Link to="/login" className="btn-primary hidden min-h-[40px] sm:inline-flex">
                Login
              </Link>
            )}
            <button
              type="button"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 p-2.5 text-slate-700 transition hover:bg-slate-50 lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </nav>
        {open && (
          <div className="border-t border-slate-200 bg-white lg:hidden">
            <div className="mx-auto flex max-h-[min(70vh,32rem)] max-w-6xl flex-col overflow-y-auto overscroll-contain px-4 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {NAV.map((n) => (
                <HomeHashLink
                  key={n.label}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className="flex min-h-[48px] items-center border-b border-slate-100 text-[15px] font-medium text-slate-700 last:border-0 hover:text-brand active:text-brand"
                >
                  {n.label}
                </HomeHashLink>
              ))}
              {isAuthenticated() ? (
                <Link
                  to="/dashboard"
                  onClick={() => setOpen(false)}
                  className="btn-primary mt-3 min-h-[44px] py-3"
                >
                  Dashboard
                </Link>
              ) : (
                <Link to="/login" onClick={() => setOpen(false)} className="btn-primary mt-3 min-h-[44px] py-3">
                  Login
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Home renders full-bleed; other public pages stay in a constrained container */}
      {isHome ? (
        <main>
          <Outlet />
        </main>
      ) : (
        <main className="mx-auto max-w-6xl px-4 py-8">
          <Outlet />
        </main>
      )}

      {/* Footer */}
      <footer id="contact" className="scroll-mt-28 border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 sm:py-12 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Logo size="md" />
            <p className="mt-2 max-w-xs text-sm text-slate-500">
              The Complete English Communication Ecosystem. Practice with AI. Perform with Humans.
            </p>
            <p className="mt-3 text-sm text-slate-500">
              SpeakEdge — A Product of Sujyoti EdTech Pvt. Ltd.
            </p>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-medium text-brand hover:underline"
            >
              WhatsApp / Mobile: {CONTACT_PHONE}
            </a>
            <SocialIcons />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Explore</div>
            <div className="mt-3 flex flex-col gap-2 text-sm text-slate-500">
              <HomeHashLink to="/#about" className="hover:text-brand">About</HomeHashLink>
              <HomeHashLink to="/#membership" className="hover:text-brand">Membership</HomeHashLink>
              <Link to="/shop" className="hover:text-brand">Book</Link>
              <Link to="/plans" className="hover:text-brand">Membership Plans</Link>
              <HomeHashLink to="/#community" className="hover:text-brand">Speaking Community</HomeHashLink>
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Join</div>
            <div className="mt-3 flex flex-col gap-2 text-sm text-slate-500">
              <Link to="/demo" className="hover:text-brand">Free Demo</Link>
              <Link to="/activate" className="hover:text-brand">Activate Membership</Link>
              <Link to="/partners" className="hover:text-brand">Partner</Link>
              <Link to="/teachers" className="hover:text-brand">Teacher</Link>
              <Link to="/login" className="hover:text-brand">Login</Link>
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Legal</div>
            <div className="mt-3 flex flex-col gap-2 text-sm text-slate-500">
              <HomeHashLink to="/#contact" className="hover:text-brand">Contact</HomeHashLink>
              <Link to="/privacy" className="hover:text-brand">Privacy Policy</Link>
              <Link to="/terms" className="hover:text-brand">Terms &amp; Conditions</Link>
              <Link to="/refund-policy" className="hover:text-brand">Cancellation &amp; Refund Policy</Link>
              <Link to="/community-rules" className="hover:text-brand">Speaking Community Rules</Link>
              <Link to="/safety-policy" className="hover:text-brand">Community Safety Policy</Link>
              <Link to="/faq" className="hover:text-brand">FAQ</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100">
          <div className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-slate-400 sm:py-5 sm:text-left pb-[max(1rem,env(safe-area-inset-bottom))]">
            © {new Date().getFullYear()} Sujyoti EdTech Pvt. Ltd. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
