import {
  Archive,
  BarChart3,
  BookOpen,
  Bell,
  CalendarCheck,
  CalendarClock,
  Compass,
  CreditCard,
  FileClock,
  Gift,
  GraduationCap,
  Handshake,
  KeySquare,
  Languages,
  Layers,
  LayoutDashboard,
  Link2,
  LogOut,
  Megaphone,
  Menu,
  ScrollText,
  Sparkles,
  ShieldCheck,
  UserCog,
  Users,
  UsersRound,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type Role } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { NotificationInbox } from '@/components/NotificationInbox';

interface NavSubItem {
  to: string;
  label: string;
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  superAdmin?: boolean;
  children?: NavSubItem[];
}

const nav: { section: string; items: NavItem[] }[] = [
  {
    section: 'Overview',
    items: [{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    section: 'People',
    items: [
      { to: '/admin/students', label: 'Users & Memberships', icon: Users },
      { to: '/admin/verification', label: 'Verification Queue', icon: ShieldCheck },
      { to: '/admin/community', label: 'Community Classes', icon: UsersRound },
      { to: '/admin/leads', label: 'Leads', icon: Megaphone },
    ],
  },
  {
    section: 'Commerce',
    items: [
      { to: '/admin/codes', label: 'Activation Codes', icon: KeySquare },
      { to: '/admin/plans', label: 'Subscription Plans', icon: Layers },
      {
        to: '/admin/payments',
        label: 'Payments',
        icon: CreditCard,
        children: [{ to: '/admin/payments/teacher-payouts', label: 'Teacher payouts' }],
      },
      { to: '/admin/books', label: 'Book Purchases', icon: BookOpen },
      {
        to: '/admin/offers',
        label: 'Offers',
        icon: Gift,
        children: [{ to: '/admin/offers/new-student', label: 'New student offers' }],
      },
    ],
  },
  {
    section: 'Network',
    items: [
      { to: '/admin/partners', label: 'Partners', icon: Handshake },
      { to: '/admin/teachers', label: 'Teachers', icon: GraduationCap },
      {
        to: '/admin/batches',
        label: 'Teacher-led Batches',
        icon: CalendarClock,
        children: [{ to: '/admin/batches/completed', label: 'Completed batches' }],
      },
      { to: '/admin/exams', label: 'Exams & Certification', icon: ScrollText },
      { to: '/admin/orientation', label: 'Orientation', icon: Compass },
    ],
  },
  {
    section: 'Learning',
    items: [
      { to: '/admin/prompt-library', label: 'Prompt Library', icon: Sparkles },
      { to: '/admin/attendance', label: 'Class Attendance', icon: CalendarCheck },
    ],
  },
  {
    section: 'Content',
    items: [
      { to: '/admin/videos', label: 'Content (Videos & PDFs)', icon: Video },
      { to: '/admin/instructions', label: 'Instructions', icon: Languages },
      { to: '/admin/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    section: 'Operations',
    items: [
      { to: '/admin/reports', label: 'Reports & Analytics', icon: BarChart3 },
      { to: '/admin/archive', label: 'Archive', icon: Archive, superAdmin: true },
      { to: '/admin/activity-logs', label: 'Activity Logs', icon: FileClock },
      { to: '/admin/roles', label: 'Roles & Permissions', icon: UserCog },
      { to: '/admin/site-links', label: 'Site Links', icon: Link2 },
    ],
  },
];

const ROLE_LABEL: Partial<Record<Role, string>> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
};

function pageTitle(pathname: string): string {
  const items = nav.flatMap((g) =>
    g.items.flatMap((i) => [i, ...(i.children ?? []).map((c) => ({ ...c, icon: i.icon }))]),
  );
  const match = items
    .filter((i) => pathname === i.to || (i.to !== '/admin' && pathname.startsWith(`${i.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return match?.label ?? 'Dashboard';
}

function navItemActive(pathname: string, item: NavItem): boolean {
  if (item.children?.length) {
    if (pathname === item.to) return true;
    if (item.children.some((c) => pathname === c.to || pathname.startsWith(`${c.to}/`))) return false;
    return pathname.startsWith(`${item.to}/`);
  }
  return pathname === item.to || (item.to !== '/admin' && pathname.startsWith(`${item.to}/`));
}

function SidebarNav({
  isSuper,
  pathname,
  onNavigate,
}: {
  isSuper: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-4">
      {nav.map((group) => {
        const items = group.items.filter((i) => !i.superAdmin || isSuper);
        if (!items.length) return null;
        return (
          <div key={group.section}>
            <div className="mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {group.section}
            </div>
            <div className="flex flex-col gap-0.5">
              {items.map((n) => {
                const active = navItemActive(pathname, n);
                return (
                  <div key={n.to}>
                    <Link
                      to={n.to}
                      onClick={onNavigate}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                        active ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <n.icon size={17} /> {n.label}
                    </Link>
                    {n.children?.map((c) => {
                      const childActive = pathname === c.to || pathname.startsWith(`${c.to}/`);
                      return (
                        <Link
                          key={c.to}
                          to={c.to}
                          onClick={onNavigate}
                          className={`ml-7 flex items-center rounded-lg px-3 py-1.5 text-xs font-medium ${
                            childActive ? 'bg-brand/10 text-brand' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                          }`}
                        >
                          {c.label}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function AdminLayout() {
  const { subject, role, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isSuper = role === 'super_admin';
  const displayName = subject?.split('@')[0] ?? 'Admin';
  const initials = displayName.slice(0, 2).toUpperCase();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-surface has-[:team-chat-page]:h-dvh has-[:team-chat-page]:max-h-dvh has-[:team-chat-page]:min-h-0 has-[:team-chat-page]:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col overflow-y-auto border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <Logo size="sm" />
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Admin
          </span>
        </div>
        <SidebarNav isSuper={isSuper} pathname={pathname} />
      </aside>

      {/* Mobile drawer overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close navigation menu"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-white p-4 shadow-xl">
            <button
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
            <div className="mb-6 flex items-center gap-2 px-2">
              <Logo size="sm" />
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Admin
              </span>
            </div>
            <SidebarNav isSuper={isSuper} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col has-[:team-chat-page]:overflow-hidden">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="rounded-lg border border-slate-200 p-2 text-slate-700 transition hover:bg-slate-50 md:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={18} />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Admin</p>
              <p className="truncate text-sm font-semibold text-slate-900">{pageTitle(pathname)}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <NotificationInbox />

            <div className="mx-2 hidden h-8 w-px bg-slate-200 sm:block" aria-hidden />

            <div className="hidden items-center gap-3 rounded-xl py-1.5 pl-1.5 pr-2 sm:flex">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-light text-sm font-bold text-white shadow-sm ring-2 ring-white">
                {initials}
              </div>
              <div className="max-w-[12rem] text-left leading-tight">
                <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
                {subject && (
                  <p className="truncate font-mono text-[11px] text-slate-400">{subject}</p>
                )}
              </div>
            </div>

            {role && ROLE_LABEL[role] && (
              <span
                className={`ml-1 hidden rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline ${
                  role === 'super_admin' ? 'bg-violet-100 text-violet-700' : 'bg-brand/10 text-brand'
                }`}
              >
                {ROLE_LABEL[role]}
              </span>
            )}

            <div className="mx-2 h-8 w-px bg-slate-200" aria-hidden />

            <button
              type="button"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
              onClick={handleLogout}
              title="Logout"
              aria-label="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="w-full px-6 py-4 has-[:team-chat-page]:flex has-[:team-chat-page]:min-h-0 has-[:team-chat-page]:flex-1 has-[:team-chat-page]:flex-col has-[:team-chat-page]:overflow-hidden has-[:team-chat-page]:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
