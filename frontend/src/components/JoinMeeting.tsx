import { Video } from 'lucide-react';

/**
 * The room a class, sitting or practice session is conducted in. Rendered only
 * where the link is already set — the "not set yet" wording belongs to the
 * surface, since it differs for a learner (waiting on it) and for the person
 * expected to add it (examiner, teacher, class owner).
 */
export function JoinMeeting({ url, className, label = 'Join meeting' }: {
  url?: string | null;
  className?: string;
  label?: string;
}) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={className ?? 'btn-primary inline-flex items-center gap-1.5 py-1.5 text-xs'}
    >
      <Video size={14} className="shrink-0" /> {label}
    </a>
  );
}
