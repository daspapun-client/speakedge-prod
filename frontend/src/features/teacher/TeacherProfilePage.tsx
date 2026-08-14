import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';

interface Profile {
  teacher_id?: string | null;
  name: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  photo_url?: string | null;
}

export function TeacherProfilePage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data } = useQuery({
    queryKey: ['teacher-my-profile'],
    queryFn: () => unwrap<Profile>(api.get('/teacher/my-profile')),
  });

  const [form, setForm] = useState({ phone: '', whatsapp: '', email: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (data) {
      setForm({
        phone: data.phone ?? '',
        whatsapp: data.whatsapp ?? '',
        email: data.email ?? '',
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => unwrap(api.put('/teacher/my-profile', form)),
    onSuccess: () => {
      setError('');
      setMessage('Profile updated.');
      qc.invalidateQueries({ queryKey: ['teacher-my-profile'] });
      qc.invalidateQueries({ queryKey: ['teacher-dashboard'] });
    },
    onError: (e: Error) => { setMessage(''); setError(e.message); },
  });

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('photo', file);
      return unwrap(api.post('/teacher/my-profile/photo', fd));
    },
    onSuccess: () => {
      setError('');
      setMessage('Photo updated.');
      qc.invalidateQueries({ queryKey: ['teacher-my-profile'] });
      qc.invalidateQueries({ queryKey: ['teacher-dashboard'] });
    },
    onError: (e: Error) => { setMessage(''); setError(e.message); },
  });

  return (
    <div>
      <PageHeader
        title="My Profile"
        description={data ? `${data.name}${data.teacher_id ? ` · ${data.teacher_id}` : ''}` : undefined}
      />
      <p className="mt-2 text-sm text-slate-500">
        You may update your contact details and photo. Name, qualification and CEFR level are managed by the admin.
      </p>

      <div className="card mt-6 max-w-lg space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            {data?.photo_url ? (
              <img src={data.photo_url} alt="" className="h-20 w-20 rounded-full object-cover ring-2 ring-slate-100" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand/10 text-2xl font-bold text-brand ring-2 ring-slate-100">
                {data?.name?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <button
              type="button"
              className="absolute -bottom-1 -right-1 rounded-full bg-white p-1.5 text-brand shadow-md transition hover:bg-slate-50"
              disabled={uploadPhoto.isPending}
              onClick={() => fileRef.current?.click()}
              aria-label="Change photo"
            >
              {uploadPhoto.isPending ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadPhoto.mutate(file);
                e.target.value = '';
              }}
            />
          </div>
          <div>
            <p className="font-semibold text-slate-800">{data?.name ?? '—'}</p>
            <button
              type="button"
              className="btn-ghost mt-1 text-sm"
              disabled={uploadPhoto.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {uploadPhoto.isPending ? 'Uploading…' : 'Change photo'}
            </button>
          </div>
        </div>

        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div>
          <label className="label">WhatsApp</label>
          <input className="input" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        {message && <p className="text-sm text-green-600">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          Save changes
        </button>
      </div>
    </div>
  );
}
