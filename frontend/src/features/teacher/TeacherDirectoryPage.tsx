import { useQuery } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';

interface DirectoryTeacher {
  teacher_id: string;
  name: string;
  photo_url?: string | null;
  badge: string;
}

export function TeacherDirectoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-directory'],
    queryFn: () => unwrap<DirectoryTeacher[]>(api.get('/teacher/directory')),
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Certified Teacher Directory</h1>
          <p className="mt-2 text-slate-600">Verified teachers of Sujyoti Language School and SpeakEdge.</p>
        </div>
        <Link to="/apply/teacher" className="btn-gold">
          Become a teacher
        </Link>
      </div>

      {isLoading ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : !data?.length ? (
        <p className="mt-6 text-slate-500">No certified teachers listed yet.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => (
            <div key={t.teacher_id} className="card flex items-center gap-4">
              {t.photo_url ? (
                <img src={t.photo_url} alt={t.name} className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <GraduationCap />
                </div>
              )}
              <div>
                <div className="font-bold">{t.name}</div>
                <div className="font-mono text-xs text-slate-400">{t.teacher_id}</div>
                <div className="mt-1 text-xs text-brand">{t.badge}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
