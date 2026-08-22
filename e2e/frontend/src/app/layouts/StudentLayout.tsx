import { useQuery } from '@tanstack/react-query';
import {
  Award,
  BarChart3,
  Bell,
  CalendarCheck,
  CalendarClock,
  Compass,
  CreditCard,
  FileText,
  Gift,
  GraduationCap,
  LayoutDashboard,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  ScrollText,
  Settings,
  Sparkles,
  Star,
  User,
  Users,
  Video,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { homeFor, useAuth, type Role } from '@/lib/auth';
import { ReviewPopup } from '@/features/dashboard/ReviewPopup';
import { ClassAttendancePopup } from '@/features/dashboard/ClassAttendancePopup';
import { MonthlyDuePopup } from '@/features/dashboard/MonthlyDuePopup';
import { Logo } from '@/components/Logo';
import { NotificationInbox } from '@/components/NotificationInbox';
import { TabBar } from '@/components/TabBar';
import { syncPushIfGranted } from '@/lib/pushNotifications';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  needsSub?: boolean;
  section?: string;
}

const STUDENT_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/dashboard/orientation', label: 'Orientation', icon: GraduationCap, section: 'Learn' },
  { to: '/dashboard/learning', label: 'Learning', icon: Sparkles, section: 'Learn' },
  { to: '/dashboard/prompt-library', label: 'Prompt Library', icon: ScrollText, section: 'Learn' },
  { to: '/dashboard/subscription', label: 'Subscription', icon: CreditCard, section: 'Learn' },
  { to: '/dashboard/videos', label: 'Videos', icon: Video, section: 'Learn' },
  { to: '/dashboard/study-material', label: 'Study Material', icon: FileText, section: 'Learn' },
  { to: '/dashboard/community', label: 'Community Classes', icon: Users, section: 'Learn' },
  { to: '/dashboard/explore', label: 'Connect Members', icon: Compass, section: 'Learn' },
  { to: '/dashboard/exams', label: 'Exams & Certification', icon: Award, needsSub: true, section: 'Learn' },
  { to: '/dashboard/batches', label: 'Teacher-led Batches', icon: CalendarClock, needsSub: true, section: 'Learn' },
  { to: '/dashboard/attendance', label: 'Attendance', icon: CalendarCheck, section: 'Learn' },
  { to: '/dashboard/reports', label: 'Reports', icon: BarChart3, section: 'Learn' },
  { to: '/dashboard/payments', label: 'Payments', icon: Wallet, section: 'Account' },
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell, section: 'Account' },
  { to: '/dashboard/offers', label: 'Offers', icon: Gift, section: 'Account' },
  { to: '/dashboard/profile', label: 'Profile', icon: User, section: 'Account' },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings, section: 'Account' },
];

const TEACHER_NAV: NavItem[] = [
  { to: '/teacher', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/teacher/batches', label: 'My Batches', icon: CalendarClock, section: 'Work' },
  { to: '/teacher/orientation', label: 'Orientation', icon: GraduationCap, section: 'Work' },
  { to: '/teacher/remuneration', label: 'Earnings', icon: Wallet, section: 'Work' },
  { to: '/teacher/reviews', label: 'Reviews', icon: Star, section: 'Work' },
  { to: '/teacher/profile', label: 'Profile', icon: User, section: 'Account' },
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell, section: 'Account' },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings, section: 'Account' },
];

const PARTNER_NAV: NavItem[] = [
  { to: '/partner', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/partner/leads', label: 'Leads', icon: Megaphone, section: 'Work' },
  { to: '/partner/reports', label: 'Reports', icon: BarChart3, section: 'Work' },
  { to: '/partner/profile', label: 'Profile', icon: User, section: 'Account' },
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell, section: 'Account' },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings, section: 'Account' },
];

const EXAMINER_NAV: NavItem[] = [
  { to: '/examiner', label: 'Assigned Exams', icon: ScrollText, end: true },
  { to: '/examiner/students', label: 'Search Students', icon: Users, section: 'Work' },
  { to: '/examiner/reports', label: 'Submitted Reports', icon: BarChart3, section: 'Work' },
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell, section: 'Account' },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings, section: 'Account' },
];

const ROLE_LABEL: Partial<Record<Role, string>> = {
  teacher: 'Teacher',
  partner: 'Partner',
  examiner: 'Examiner',
};

function navFor(role: Role | null): NavItem[] {
  switch (role) {
    case 'teacher':
      return TEACHER_NAV;
    case 'partner':
      return PARTNER_NAV;
    case 'examiner':
      return EXAMINER_NAV;
    default:
      return STUDENT_NAV;
  }
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

function groupNavItems(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const item of items) {
    const label = item.section;
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

function NavItemLink({
  item,
  lock,
  reason,
  onNavigate,
}: {
  item: NavItem;
  lock: boolean;
  reason: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  if (lock) {
    return (
      <span
        aria-disabled
        title={reason}
        className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300"
      >
        <Icon size={17} className="shrink-0 opacity-60" />
        {item.label}
        <Lock size={12} className="ml-auto shrink-0 opacity-60" />
      </span>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-brand text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        ].join(' ')
      }
    >
      <Icon size={17} className="shrink-0" />
      {item.label}
    </NavLink>
  );
}

function SidebarNav({
  items,
  membershipLocked,
  noSub,
  onNavigate,
}: {
  items: NavItem[];
  membershipLocked: boolean;
  noSub: boolean;
  onNavigate?: () => void;
}) {
  const groups = groupNavItems(items);

  return (
    <nav className="flex flex-1 flex-col gap-4" aria-label="Main navigation">
      {groups.map((group) => (
        <div key={group.label ?? group.items[0]?.to}>
          {group.label && (
            <div className="mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {group.label}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map((n) => {
              const lock = !!(membershipLocked || (n.needsSub && noSub));
              const reason = membershipLocked
                ? 'Available once your membership is approved'
                : 'Requires an active subscription';
              return (
                <NavItemLink
                  key={n.to}
                  item={n}
                  lock={lock}
                  reason={reason}
                  onNavigate={onNavigate}
                />
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SidebarLogoutFooter({
  displayName,
  onLogout,
  className = '',
}: {
  displayName: string | null;
  onLogout: () => void;
  className?: string;
}) {
  return (
    <div className={className}>
      {displayName && (
        <p className="mb-2 truncate px-1 text-xs font-medium text-slate-500">{displayName}</p>
      )}
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600 transition active:scale-[0.98] hover:bg-red-100"
        onClick={onLogout}
      >
        <LogOut size={16} />
        Logout
      </button>
    </div>
  );
}

function SidebarContent({
  home,
  role,
  displayName,
  nav,
  membershipLocked,
  noSub,
  onNavigate,
  onLogout,
  showLogout = true,
}: {
  home: string;
  role: Role | null;
  displayName: string | null;
  nav: NavItem[];
  membershipLocked: boolean;
  noSub: boolean;
  onNavigate?: () => void;
  onLogout?: () => void;
  showLogout?: boolean;
}) {
  return (
    <>
      <Link to={home} aria-label="SpeakEdge home" className="mb-6 flex items-center gap-2 px-2">
        <Logo size="sm" />
        {role && ROLE_LABEL[role] && (
          <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
            {ROLE_LABEL[role]}
          </span>
        )}
      </Link>

      <SidebarNav
        items={nav}
        membershipLocked={membershipLocked}
        noSub={noSub}
        onNavigate={onNavigate}
      />

      {showLogout && onLogout && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <SidebarLogoutFooter displayName={displayName} onLogout={onLogout} />
        </div>
      )}
    </>
  );
}

function profileFor(role: Role | null): string {
  switch (role) {
    case 'teacher':
      return '/teacher/profile';
    case 'partner':
      return '/partner/profile';
    default:
      return '/dashboard/profile';
  }
}

function mobileHeaderTitle(pathname: string, nav: NavItem[], home: string): string | null {
  if (pathname === home) return null;
  const match = nav.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  return match?.label ?? null;
}

export function StudentLayout() {
  const { subject, role, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const NAV = navFor(role);
  const home = homeFor(role);
  const pageTitle = mobileHeaderTitle(pathname, NAV, home);

  const isStudent = !role || role === 'student';
  const { data: dash } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () =>
      unwrap<{
        full_name: string;
        photo_url?: string | null;
        membership_status: string;
        subscription: unknown | null;
      }>(api.get('/dashboard/')),
    enabled: isStudent,
  });
  const { data: teacherDash } = useQuery({
    queryKey: ['teacher-dashboard'],
    queryFn: () =>
      unwrap<{ name: string; photo_url?: string | null }>(api.get('/teacher/dashboard')),
    enabled: role === 'teacher',
  });
  const { data: partnerDash } = useQuery({
    queryKey: ['partner-dashboard'],
    queryFn: () => unwrap<{ name: string }>(api.get('/partner/dashboard')),
    enabled: role === 'partner',
  });
  const displayName = dash?.full_name ?? teacherDash?.name ?? partnerDash?.name ?? subject;
  const photoUrl = dash?.photo_url ?? teacherDash?.photo_url ?? null;
  const membershipLocked = isStudent && !!dash && dash.membership_status !== 'Active';
  const noSub = isStudent && !!dash && dash.membership_status === 'Active' && !dash.subscription;

  useEffect(() => {
    if (subject) void syncPushIfGranted();
  }, [subject]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-layout flex min-h-screen bg-surface has-[:team-chat-page]:h-dvh has-[:team-chat-page]:max-h-dvh has-[:team-chat-page]:min-h-0 has-[:team-chat-page]:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-4 md:flex">
        <SidebarContent
          home={home}
          role={role}
          displayName={displayName}
          nav={NAV}
          membershipLocked={membershipLocked}
          noSub={noSub}
        />
      </aside>

      {/* Mobile drawer overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close navigation menu"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col overflow-hidden bg-white shadow-xl">
            <button
              className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-10">
              <SidebarContent
                home={home}
                role={role}
                displayName={displayName}
                nav={NAV}
                membershipLocked={membershipLocked}
                noSub={noSub}
                showLogout={false}
                onNavigate={() => setMenuOpen(false)}
              />
            </div>
            <div className="shrink-0 border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <SidebarLogoutFooter
                displayName={displayName}
                onLogout={() => {
                  setMenuOpen(false);
                  handleLogout();
                }}
              />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col has-[:team-chat-page]:min-h-0 has-[:team-chat-page]:overflow-hidden">
        {/* Mobile top bar */}
        <header className="mobile-topbar">
          <div className="mobile-topbar-inner">
            <button
              type="button"
              className="mobile-topbar-btn"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} strokeWidth={2.25} />
            </button>

            {pageTitle ? (
              <div className="min-w-0 flex-1 px-1">
                <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-slate-900">
                  {pageTitle}
                </p>
                {role && ROLE_LABEL[role] && (
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-brand/80">
                    {ROLE_LABEL[role]}
                  </p>
                )}
              </div>
            ) : (
              <Link
                to={home}
                aria-label="SpeakEdge home"
                className="flex min-w-0 flex-1 items-center gap-2 px-0.5"
              >
                <Logo size="sm" />
                {role && ROLE_LABEL[role] && (
                  <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand">
                    {ROLE_LABEL[role]}
                  </span>
                )}
              </Link>
            )}

            <div className="mobile-topbar-actions">
              <NotificationInbox compact />
              <Link
                to={profileFor(role)}
                aria-label="Your profile"
                className="shrink-0 rounded-xl bg-gradient-to-br from-brand to-brand-gold p-[1.5px] shadow-sm transition active:scale-[0.92]"
              >
                <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[0.65rem] bg-white">
                  {photoUrl ? (
                    <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand to-brand-light text-xs font-bold text-white">
                      {displayName?.[0]?.toUpperCase() ?? '?'}
                    </span>
                  )}
                </span>
              </Link>
            </div>
          </div>
        </header>

        {/* Desktop top bar */}
        <header className="sticky top-0 z-20 hidden h-16 items-center justify-end border-b border-slate-200/80 bg-white/80 px-6 backdrop-blur-md md:flex">
          <div className="flex items-center gap-1">
            <NotificationInbox />

            <div className="mx-2 h-8 w-px bg-slate-200" aria-hidden />

            <Link
              to={profileFor(role)}
              className="flex items-center gap-3 rounded-xl py-1.5 pl-1.5 pr-3 transition-colors hover:bg-slate-100/80"
            >
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover ring-2 ring-white shadow-sm"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-light text-sm font-bold text-white shadow-sm ring-2 ring-white">
                  {displayName?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <div className="text-left leading-tight">
                <p className="text-sm font-semibold text-slate-900">{displayName}</p>
                {subject && subject !== displayName && (
                  <p className="font-mono text-[11px] text-slate-400">{subject}</p>
                )}
              </div>
            </Link>

            {role && ROLE_LABEL[role] && (
              <span className="ml-1 rounded-full bg-brand/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                {ROLE_LABEL[role]}
              </span>
            )}

            <div className="mx-2 h-8 w-px bg-slate-200" aria-hidden />

            <button
              type="button"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
              onClick={handleLogout}
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {membershipLocked && (
          <div className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
            <GraduationCap size={14} className="shrink-0" />
            <span>
              Your membership is {dash?.membership_status ?? 'pending approval'}. Features unlock once an admin approves it.
            </span>
          </div>
        )}
        {noSub && (
          <div className="border-b border-brand/20 bg-brand/5 px-4 py-2 text-center text-xs text-brand">
            Subscribe to unlock live batches and exams.{' '}
            <Link to="/dashboard/subscription" className="font-semibold underline underline-offset-2">
              View plans
            </Link>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 pb-[max(7rem,env(safe-area-inset-bottom)+5.75rem)] has-[:team-chat-page]:flex has-[:team-chat-page]:min-h-0 has-[:team-chat-page]:flex-col has-[:team-chat-page]:overflow-hidden has-[:team-chat-page]:pb-0 sm:px-4 sm:py-6 md:px-4 md:py-8 md:pb-8">
          <Outlet />
        </main>
      </div>

      {isStudent && <ReviewPopup />}
      {isStudent && <ClassAttendancePopup />}
      {isStudent && <MonthlyDuePopup />}

      <a
        href="https://wa.me/918240861168"
        title="WhatsApp Support: 8240861168"
        className="fixed bottom-[calc(6.5rem+max(0.75rem,env(safe-area-inset-bottom)))] right-3 z-30 flex items-center gap-2 rounded-full bg-green-500 px-3.5 py-2.5 text-sm font-semibold text-white shadow-lg transition active:scale-95 hover:bg-green-600 hover:shadow-xl md:bottom-5 md:right-5 md:px-4 md:py-3"
      >
        <MessageCircle size={18} className="shrink-0" />
        <span className="hidden sm:inline">Support: 8240861168</span>
      </a>

      {/* TabBar links are student routes — teachers/partners/examiners use the sidebar. */}
      {!menuOpen && isStudent && <TabBar />}
    </div>
  );
}
