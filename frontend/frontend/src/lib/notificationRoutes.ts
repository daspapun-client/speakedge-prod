import type { Role } from '@/lib/auth';

export interface NotificationLike {
  kind: string;
  title: string;
  body?: string;
}

/** Best-effort in-app destination for a notification (kind + title heuristics). */
export function notificationHref(n: NotificationLike, role: Role | null = 'student'): string {
  const t = n.title.toLowerCase();

  // Admins live under /admin/* — keep their bell links inside that area.
  if (role === 'admin' || role === 'super_admin') {
    // Attendance-confirmation events have their own monitoring screen.
    if (t.includes('confirm your attendance') || t.includes('class cancelled'))
      return '/admin/attendance';
    if (t.includes('batch')) return '/admin/batches';
    if (
      t.includes('teacher') ||
      t.includes('attendance') ||
      t.includes('payment') ||
      t.includes('remuneration') ||
      t.includes('class reminder')
    )
      return '/admin/teachers';
    return '/admin/notifications';
  }

  // Attendance workflow (24h confirmation request / automatic cancellation).
  if (t.includes('confirm your attendance') || t.includes('class cancelled'))
    return role === 'teacher' ? '/teacher/batches' : '/dashboard/attendance';

  if (t.includes('join request') || t.includes('community request')) return '/dashboard/community';
  if (t.includes('new message in')) {
    const batchMatch = n.body?.match(/View chat: batch\/([a-f0-9]+)/i);
    if (batchMatch) {
      const anchor = `#batch-${batchMatch[1]}`;
      return role === 'teacher' ? `/teacher/batches${anchor}` : `/dashboard/batches${anchor}`;
    }
    const teamMatch = n.body?.match(/View chat: team\/([a-f0-9]+)/i);
    if (teamMatch) return `/dashboard/community/${teamMatch[1]}`;
    return role === 'teacher' ? '/teacher/batches' : '/dashboard/community';
  }
  if (t.includes('batch join')) return role === 'teacher' ? '/teacher/batches' : '/dashboard/batches';
  if (t.includes('report card') || t.includes('certificate')) return '/dashboard/reports';
  if (t.includes('exam booking')) return '/dashboard/exams';
  if (t.includes('payment received') || t.includes('book order')) return '/dashboard/payments';
  if (t.includes('membership')) return '/dashboard';

  if (role === 'teacher') {
    if (t.includes('attendance')) return '/teacher/batches';
    if (t.includes('payment processed')) return '/teacher/remuneration';
    if (t.includes('batch')) return '/teacher/batches';
  }

  switch (n.kind) {
    case 'community': {
      const teamMatch = n.body?.match(/View chat: team\/([a-f0-9]+)/i);
      if (teamMatch) return `/dashboard/community/${teamMatch[1]}`;
      return '/dashboard/community';
    }
    case 'exam':
      return '/dashboard/exams';
    case 'payment':
      return role === 'teacher' ? '/teacher/remuneration' : '/dashboard/payments';
    case 'membership':
    case 'subscription':
      return '/dashboard/subscription';
    case 'approval':
      return t.includes('community') || t.includes('join') ? '/dashboard/community' : '/dashboard';
    case 'promo':
      return '/dashboard/offers';
    default:
      return '/dashboard/notifications';
  }
}
