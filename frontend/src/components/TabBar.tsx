import { NavLink, useLocation } from 'react-router-dom';
import {
  CalendarClock,
  LayoutDashboard,
  School,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';

interface TabItem {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
}

const LEFT_TABS: TabItem[] = [
  { id: 'chat', label: 'Community Classes', to: '/dashboard/community', icon: School },
  { id: 'videos', label: 'Videos', to: '/dashboard/videos', icon: Video },
];

const RIGHT_TABS: TabItem[] = [
  { id: 'explore', label: 'Members', to: '/dashboard/explore', icon: Users },
  { id: 'batches', label: 'Teacher-led Batches', to: '/dashboard/batches', icon: CalendarClock },
];

function tabActive(id: string, pathname: string): boolean {
  if (id === 'chat') return pathname.startsWith('/dashboard/community');
  if (id === 'videos') return pathname.startsWith('/dashboard/videos');
  if (id === 'explore') return pathname.startsWith('/dashboard/explore');
  if (id === 'batches') return pathname.startsWith('/dashboard/batches');
  return false;
}

function TabButton({ item, active }: { item: TabItem; active: boolean }) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      role="tab"
      aria-selected={active}
      aria-current={active ? 'page' : undefined}
      className={['tabbar-btn', active ? 'active' : ''].filter(Boolean).join(' ')}
    >
      <span className="tabbar-icon" aria-hidden>
        <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
      </span>
      <span className="tabbar-label">{item.label}</span>
    </NavLink>
  );
}

export function TabBar() {
  const { pathname } = useLocation();
  const inTeamChat = /\/community\/[^/]+/.test(pathname);
  const dashboardActive = pathname === '/dashboard';

  if (inTeamChat) return null;

  return (
    <nav className="tabbar" role="tablist" aria-label="Primary">
      <div className="tabbar-dock">
        {LEFT_TABS.map((item) => (
          <TabButton key={item.id} item={item} active={tabActive(item.id, pathname)} />
        ))}

        <div className="tabbar-fab-slot">
          <NavLink
            to="/dashboard"
            end
            role="tab"
            aria-label="Home"
            aria-selected={dashboardActive}
            aria-current={dashboardActive ? 'page' : undefined}
            className={['tabbar-fab', dashboardActive ? 'active' : ''].filter(Boolean).join(' ')}
          >
            <LayoutDashboard size={28} strokeWidth={2.5} />
          </NavLink>
          <span className="tabbar-fab-label">Home</span>
        </div>

        {RIGHT_TABS.map((item) => (
          <TabButton key={item.id} item={item} active={tabActive(item.id, pathname)} />
        ))}
      </div>
    </nav>
  );
}
