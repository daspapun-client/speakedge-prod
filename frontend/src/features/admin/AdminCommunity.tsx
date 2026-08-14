import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, MessageCircle, Plus, Trash2, Users, X, Ban, ShieldCheck, BarChart3, Pencil, ClipboardCheck, Star } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { TeamMembersModal } from '@/features/dashboard/MemberList';
import { AdminStudentLink, Column, DataTable, Modal, PageHeader, StatusBadge, fmtDate } from './_shared';

const MAX_COMMUNITY_SIZE = 8;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
type AdminTab = 'classes' | 'attendance';
type AttendanceFilter = 'all' | 'submitted' | 'pending';

const fmtSessionDay = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

type MemberPick = { student_id: string; name: string };

function MemberMultiSelect({
  members,
  onChange,
  maxMembers,
  ownerId,
}: {
  members: MemberPick[];
  onChange: (members: MemberPick[]) => void;
  maxMembers: number;
  ownerId?: string | null;
}) {
  const [q, setQ] = useState('');
  const chosen = new Set(members.map((m) => m.student_id));
  const atCapacity = members.length >= maxMembers;
  const { data, isLoading } = useQuery({
    queryKey: ['student-search', q],
    queryFn: () => unwrap<{ items: { student_id: string; full_name: string }[] }>(
      api.get('/admin/students', { params: { q, page_size: 20 } })),
    enabled: !!q.trim() && !atCapacity,
  });
  const results = (data?.items ?? []).filter((s) => !chosen.has(s.student_id));

  const remove = (studentId: string) => {
    if (studentId === ownerId) return;
    onChange(members.filter((m) => m.student_id !== studentId));
  };

  const add = (s: { student_id: string; full_name: string }) => {
    if (atCapacity || chosen.has(s.student_id)) return;
    onChange([...members, { student_id: s.student_id, name: s.full_name }]);
    setQ('');
  };

  return (
    <div>
      <label className="label">
        Members <span className="font-normal text-slate-400">({members.length}/{maxMembers})</span>
      </label>
      {members.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {members.map((m) => {
            const isOwner = m.student_id === ownerId;
            return (
              <span
                key={m.student_id}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  isOwner ? 'bg-brand/15 text-brand' : 'cursor-pointer bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                onClick={() => remove(m.student_id)}
                title={isOwner ? 'Owner — change owner to remove' : 'Remove member'}
              >
                {m.name}
                {isOwner ? ' · owner' : ' ✕'}
              </span>
            );
          })}
        </div>
      )}
      <input
        className="input"
        placeholder={atCapacity ? 'Member limit reached' : 'Search students to add…'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={atCapacity}
      />
      {q.trim() && !atCapacity && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200">
          {isLoading && <p className="p-2 text-sm text-slate-400">Searching…</p>}
          {!isLoading && !results.length && <p className="p-2 text-sm text-slate-400">No matches.</p>}
          {results.map((s) => (
            <button
              key={s.student_id}
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => add(s)}
            >
              <span>{s.full_name}</span>
              <span className="font-mono text-xs text-slate-400">{s.student_id}</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-slate-400">Search and click to add students. Click a chip to remove (owner cannot be removed here).</p>
    </div>
  );
}

function CommunityClassModal({ team, onClose, onDone }: { team?: AdminTeam; onClose: () => void; onDone: () => void }) {
  const editing = !!team;
  const [error, setError] = useState('');
  const [ownerQ, setOwnerQ] = useState('');
  const [owner, setOwner] = useState<{ student_id: string; name: string } | null>(
    team?.owner_student_id
      ? { student_id: team.owner_student_id, name: team.owner_name ?? team.owner_student_id }
      : null,
  );
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [maxMembers, setMaxMembers] = useState(String(team?.max_members ?? 4));
  const [classDay, setClassDay] = useState(team?.class_day ?? '');
  const [classTime, setClassTime] = useState(team?.class_time ?? '');
  const [members, setMembers] = useState<MemberPick[]>([]);
  const [membersReady, setMembersReady] = useState(!editing);

  const rosterQuery = useQuery({
    queryKey: ['team-members-edit', team?.id],
    queryFn: () => unwrap<{ members: { student_id: string; display_name?: string; first_name?: string }[] }>(
      api.get(`/community/teams/${team!.id}/members`)),
    enabled: editing,
  });

  useEffect(() => {
    if (!editing || membersReady || !rosterQuery.data) return;
    setMembers(rosterQuery.data.members.map((m) => ({
      student_id: m.student_id,
      name: m.display_name || m.first_name || m.student_id,
    })));
    setMembersReady(true);
  }, [editing, membersReady, rosterQuery.data]);

  useEffect(() => {
    if (!owner) return;
    setMembers((cur) =>
      cur.some((m) => m.student_id === owner.student_id)
        ? cur
        : [...cur, { student_id: owner.student_id, name: owner.name }],
    );
  }, [owner?.student_id]);

  const ownerSearch = useQuery({
    queryKey: ['student-search', ownerQ],
    queryFn: () => unwrap<{ items: { student_id: string; full_name: string }[] }>(
      api.get('/admin/students', { params: { q: ownerQ, page_size: 20 } })),
    enabled: !!ownerQ.trim() && !owner,
  });

  const save = useMutation({
    mutationFn: (fd: FormData) =>
      editing
        ? unwrap(api.put(`/community/admin/teams/${team!.id}`, fd))
        : unwrap(api.post('/community/admin/teams', fd)),
    onSuccess: () => { setError(''); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  const memberLimit = Number(maxMembers) || MAX_COMMUNITY_SIZE;
  const minMembers = editing ? Math.max(members.length, 1) : 1;
  const scheduleValid = (!classDay && !classTime) || (!!classDay && !!classTime);
  const valid =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    description.length <= 200 &&
    Number(maxMembers) >= minMembers &&
    Number(maxMembers) <= MAX_COMMUNITY_SIZE &&
    (!editing || members.length <= memberLimit) &&
    scheduleValid &&
    (!editing || membersReady);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const fd = new FormData();
    fd.append('name', name.trim());
    fd.append('description', description.trim());
    fd.append('max_members', maxMembers);
    if (owner) fd.append('owner_student_id', owner.student_id);
    fd.append('class_day', classDay);
    fd.append('class_time', classTime);
    if (editing) members.forEach((m) => fd.append('member_student_ids', m.student_id));
    save.mutate(fd);
  };

  const results = ownerSearch.data?.items ?? [];

  return (
    <Modal onClose={onClose}>
      <h3 className="text-lg font-bold text-slate-800">{editing ? 'Edit community class' : 'Create community class'}</h3>
      <p className="mt-1 text-sm text-slate-500">
        {editing ? 'Update name, description, members, capacity, schedule, or owner.' : 'Set up a speaking group. Optionally assign a student as owner.'}
      </p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <form className="mt-5 space-y-4" onSubmit={submit}>
        <div>
          <label className="label">Owner <span className="font-normal text-slate-400">(optional)</span></label>
          {owner ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-slate-800">{owner.name}</div>
                <div className="font-mono text-xs text-slate-400">{owner.student_id}</div>
              </div>
              <button type="button" className="text-xs text-slate-500 hover:text-slate-700" onClick={() => { setOwner(null); setOwnerQ(''); }}>
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                className="input"
                placeholder="Search by name or student ID…"
                value={ownerQ}
                onChange={(e) => setOwnerQ(e.target.value)}
              />
              {ownerQ.trim() && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200">
                  {ownerSearch.isLoading && <p className="p-2 text-sm text-slate-400">Searching…</p>}
                  {!ownerSearch.isLoading && !results.length && <p className="p-2 text-sm text-slate-400">No matches.</p>}
                  {results.map((s) => (
                    <button
                      key={s.student_id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => { setOwner({ student_id: s.student_id, name: s.full_name }); setOwnerQ(''); }}
                    >
                      <span>{s.full_name}</span>
                      <span className="font-mono text-xs text-slate-400">{s.student_id}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <label className="label">Community class name</label>
          <input className="input" placeholder="e.g. Morning English Club" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="input"
            rows={3}
            placeholder="What will members practice together?"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 200))}
            maxLength={200}
          />
          <p className="mt-1 text-right text-xs text-slate-400">{description.length}/200</p>
        </div>
        <div>
          <label className="label">Member limit</label>
          <input
            className="input"
            type="number"
            min={minMembers}
            max={MAX_COMMUNITY_SIZE}
            value={maxMembers}
            onChange={(e) => setMaxMembers(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">
            Maximum group size ({minMembers}–{MAX_COMMUNITY_SIZE}{owner ? ', including the owner' : ''})
          </p>
        </div>
        {editing && (
          rosterQuery.isLoading ? (
            <p className="text-sm text-slate-400">Loading members…</p>
          ) : (
            <MemberMultiSelect
              members={members}
              onChange={setMembers}
              maxMembers={memberLimit}
              ownerId={owner?.student_id}
            />
          )
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Class day <span className="font-normal text-slate-400">(optional)</span></label>
            <select className="input" value={classDay} onChange={(e) => setClassDay(e.target.value)}>
              <option value="">—</option>
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Class time</label>
            <input className="input" type="time" value={classTime} onChange={(e) => setClassTime(e.target.value)} />
          </div>
          {!scheduleValid && <p className="col-span-2 text-xs text-red-600">Set both a day and a time, or leave both blank.</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary inline-flex items-center gap-1" disabled={!valid || save.isPending}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : editing ? <Pencil size={16} /> : <Plus size={16} />}
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface JoinRequest {
  id: string;
  team_id: string;
  team_name: string;
  owner_student_id: string | null;
  owner_photo_url?: string | null;
  owner_gender?: string | null;
  owner_name?: string | null;
  requester_student_id: string;
  requester_name: string;
  requester_photo_url?: string | null;
  requester_gender?: string | null;
  status: string;
  created_at: string;
}

interface AdminTeam {
  id: string;
  name: string;
  owner_student_id?: string | null;
  owner_name?: string | null;
  owner_photo_url?: string | null;
  owner_gender?: string | null;
  member_count: number;
  max_members: number;
  description?: string | null;
  updated_at?: string;
  is_suspended?: boolean;
  class_day?: string | null;
  class_time?: string | null;
}

interface SessionRatings {
  session_date: string;
  confirmed: number;
  attended: number;
  avg_rating: number | null;
  rating_count: number;
}

interface AttendanceRow {
  id: string;
  team_id: string;
  team_name: string;
  session_date: string;
  student_id: string;
  student_name: string;
  student_photo_url?: string | null;
  student_gender?: string | null;
  attended: boolean | null;
  rating: number | null;
  responded_at: string | null;
  response_status: 'attended' | 'missed' | 'awaiting';
}

function fmtSchedule(day?: string | null, time?: string | null): string | null {
  if (!day || !time) return null;
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${day[0].toUpperCase()}${day.slice(1)}s · ${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function ClassRatingsModal({ team, onClose }: { team: AdminTeam; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-class-attendance', team.id],
    queryFn: () => unwrap<SessionRatings[]>(api.get(`/community/admin/teams/${team.id}/attendance`)),
  });
  return (
    <Modal onClose={onClose} wide>
      <h3 className="text-lg font-bold text-slate-800">Attendance & ratings — {team.name}</h3>
      <p className="mt-1 text-sm text-slate-500">{fmtSchedule(team.class_day, team.class_time) ?? 'No schedule set'}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-2 pr-4">Session</th>
              <th className="py-2 pr-4">Confirmed</th>
              <th className="py-2 pr-4">Attended</th>
              <th className="py-2">Avg rating</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="py-4 text-slate-400">Loading…</td></tr>}
            {!isLoading && !data?.length && <tr><td colSpan={4} className="py-4 text-slate-400">No sessions yet.</td></tr>}
            {data?.map((s) => (
              <tr key={s.session_date} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-700">{fmtDate(s.session_date)}</td>
                <td className="py-2 pr-4 text-slate-600">{s.confirmed}</td>
                <td className="py-2 pr-4 text-slate-600">{s.attended}</td>
                <td className="py-2 text-slate-700">
                  {s.avg_rating != null ? `★ ${s.avg_rating} (${s.rating_count})` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function AdminCommunity() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<AdminTab>('classes');
  const [attendanceFilter, setAttendanceFilter] = useState<AttendanceFilter>('all');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingTeam, setEditingTeam] = useState<AdminTeam | null>(null);
  const [membersTeam, setMembersTeam] = useState<AdminTeam | null>(null);
  const [ratingsTeam, setRatingsTeam] = useState<AdminTeam | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);

  const joinReqs = useQuery({
    queryKey: ['admin-community-join-requests'],
    queryFn: () => unwrap<JoinRequest[]>(api.get('/community/admin/join-requests', { params: { status: 'pending' } })),
  });

  const teams = useQuery({
    queryKey: ['admin-community-teams'],
    queryFn: () => unwrap<AdminTeam[]>(api.get('/community/admin/teams')),
  });

  const attendance = useQuery({
    queryKey: ['admin-community-attendance', attendanceFilter],
    queryFn: () => unwrap<AttendanceRow[]>(
      api.get('/community/admin/attendance', { params: { response: attendanceFilter } })),
    enabled: tab === 'attendance',
  });

  const deleteTeam = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/community/teams/${id}`)),
    onSuccess: () => {
      setError('');
      qc.invalidateQueries({ queryKey: ['admin-community-teams'] });
      qc.invalidateQueries({ queryKey: ['admin-community-join-requests'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const respondJoin = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'decline' }) =>
      unwrap(api.post(`/community/admin/join-requests/${id}/${action}`, {})),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['admin-community-join-requests'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const removeMember = useMutation({
    mutationFn: ({ teamId, studentId }: { teamId: string; studentId: string }) =>
      unwrap(api.delete(`/community/teams/${teamId}/members/${studentId}`)),
    onMutate: ({ studentId }) => setRemovingId(studentId),
    onSuccess: (_, { teamId }) => {
      setError('');
      setRemovingId(null);
      qc.invalidateQueries({ queryKey: ['team-members', teamId] });
      qc.invalidateQueries({ queryKey: ['admin-community-teams'] });
    },
    onError: (e: Error) => { setError(e.message); setRemovingId(null); },
  });

  const toggleSuspend = useMutation({
    mutationFn: ({ id, suspend }: { id: string; suspend: boolean }) =>
      unwrap(api.post(`/community/admin/teams/${id}/${suspend ? 'suspend' : 'unsuspend'}`, {})),
    onMutate: ({ id }) => setSuspendingId(id),
    onSuccess: () => {
      setError('');
      setSuspendingId(null);
      qc.invalidateQueries({ queryKey: ['admin-community-teams'] });
    },
    onError: (e: Error) => { setError(e.message); setSuspendingId(null); },
  });

  const joinColumns: Column<JoinRequest>[] = [
    { key: 'created_at', header: 'When', sort: (r) => r.created_at, cell: (r) => <span className="text-slate-500">{fmtDate(r.created_at)}</span> },
    { key: 'requester_name', header: 'Requester', sort: (r) => r.requester_name, cell: (r) => (
      <div>
        <AdminStudentLink
          studentId={r.requester_student_id}
          name={r.requester_name}
          photoUrl={r.requester_photo_url}
          gender={r.requester_gender}
        />
      </div>
    ) },
    { key: 'team_name', header: 'Community Class', sort: (r) => r.team_name, cell: (r) => (
      <div>
        <div className="text-slate-700">{r.team_name}</div>
        {r.owner_student_id && (
          <AdminStudentLink
            studentId={r.owner_student_id}
            name={r.owner_name}
            photoUrl={r.owner_photo_url}
            gender={r.owner_gender}
            avatarSize="h-7 w-7"
            iconSize={14}
            className="mt-1 py-0.5"
          />
        )}
      </div>
    ) },
    { key: 'status', header: 'Status', sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'actions', header: '', width: '1%', cell: (r) => (
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          title="Approve"
          disabled={respondJoin.isPending}
          onClick={() => respondJoin.mutate({ id: r.id, action: 'approve' })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
        >
          <Check size={14} strokeWidth={2.25} />
          Approve
        </button>
        <button
          type="button"
          title="Decline"
          disabled={respondJoin.isPending}
          onClick={() => respondJoin.mutate({ id: r.id, action: 'decline' })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:opacity-50"
        >
          <X size={14} />
          Decline
        </button>
      </div>
    ) },
  ];

  const teamColumns: Column<AdminTeam>[] = [
    { key: 'name', header: 'Community Class', sort: (t) => t.name, cell: (t) => (
      <div>
        <div className="font-medium text-slate-800">{t.name}</div>
        {fmtSchedule(t.class_day, t.class_time) && (
          <div className="mt-0.5 text-xs font-medium text-brand/80">{fmtSchedule(t.class_day, t.class_time)}</div>
        )}
        {t.description && <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400">{t.description}</div>}
      </div>
    ) },
    { key: 'owner_student_id', header: 'Owner', sort: (t) => t.owner_student_id ?? '', cell: (t) => (
      t.owner_student_id ? (
        <AdminStudentLink
          studentId={t.owner_student_id}
          name={t.owner_name}
          photoUrl={t.owner_photo_url}
          gender={t.owner_gender}
          avatarSize="h-8 w-8"
          iconSize={16}
        />
      ) : (
        <span className="text-slate-400">—</span>
      )
    ) },
    { key: 'member_count', header: 'Members', sort: (t) => t.member_count, cell: (t) => (
      <button
        type="button"
        onClick={() => setMembersTeam(t)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-slate-600 transition hover:bg-brand/10 hover:text-brand"
        title="View members"
      >
        <Users size={14} />
        {t.member_count} / {t.max_members}
      </button>
    ) },
    { key: 'status', header: 'Status', sort: (t) => (t.is_suspended ? 'suspended' : 'active'), cell: (t) => (
      <StatusBadge status={t.is_suspended ? 'suspended' : 'active'} />
    ) },
    { key: 'updated_at', header: 'Updated', sort: (t) => t.updated_at ?? '', cell: (t) => (
      <span className="text-slate-500">{t.updated_at ? fmtDate(t.updated_at) : '—'}</span>
    ) },
    { key: 'actions', header: '', width: '1%', cell: (t) => (
      <div className="flex justify-end">
        <div className="inline-flex items-stretch overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04]">
          <button
            type="button"
            title="Edit details"
            onClick={() => setEditingTeam(t)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <Pencil size={14} strokeWidth={2.25} />
            Edit
          </button>
          <span className="w-px shrink-0 self-stretch bg-slate-200" aria-hidden />
          <Link
            to={`/admin/community/${t.id}`}
            title="Open chat"
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand/5"
          >
            <MessageCircle size={14} strokeWidth={2.25} />
            Chat
          </Link>
          <span className="w-px shrink-0 self-stretch bg-slate-200" aria-hidden />
          <button
            type="button"
            title="Attendance & ratings"
            onClick={() => setRatingsTeam(t)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <BarChart3 size={14} strokeWidth={2.25} />
            Ratings
          </button>
          <span className="w-px shrink-0 self-stretch bg-slate-200" aria-hidden />
          <button
            type="button"
            title={t.is_suspended ? 'Unsuspend community class' : 'Suspend community class'}
            disabled={suspendingId === t.id}
            onClick={() => {
              const msg = t.is_suspended
                ? `Unsuspend “${t.name}”? Members will be able to chat again.`
                : `Suspend “${t.name}”? Chat will be disabled until you unsuspend it.`;
              if (window.confirm(msg)) toggleSuspend.mutate({ id: t.id, suspend: !t.is_suspended });
            }}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
              t.is_suspended
                ? 'text-emerald-700 hover:bg-emerald-50'
                : 'text-amber-700 hover:bg-amber-50'
            }`}
          >
            {suspendingId === t.id ? (
              <Loader2 size={14} className="animate-spin" />
            ) : t.is_suspended ? (
              <ShieldCheck size={14} strokeWidth={2.25} />
            ) : (
              <Ban size={14} strokeWidth={2.25} />
            )}
            {t.is_suspended ? 'Unsuspend' : 'Suspend'}
          </button>
          <span className="w-px shrink-0 self-stretch bg-slate-200" aria-hidden />
          <button
            type="button"
            title="Delete community class"
            disabled={deleteTeam.isPending}
            onClick={() => {
              if (window.confirm(`Delete community class “${t.name}”? This cannot be undone.`)) deleteTeam.mutate(t.id);
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            {deleteTeam.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} strokeWidth={2.25} />}
            Delete
          </button>
        </div>
      </div>
    ) },
  ];

  const attendanceColumns: Column<AttendanceRow>[] = [
    { key: 'session_date', header: 'Class session', sort: (r) => r.session_date, cell: (r) => (
      <span className="text-slate-700">{fmtSessionDay(r.session_date)}</span>
    ) },
    { key: 'student_name', header: 'Student', sort: (r) => r.student_name, cell: (r) => (
      <AdminStudentLink
        studentId={r.student_id}
        name={r.student_name}
        photoUrl={r.student_photo_url}
        gender={r.student_gender}
      />
    ) },
    { key: 'team_name', header: 'Community class', sort: (r) => r.team_name, cell: (r) => (
      <span className="font-medium text-slate-800">{r.team_name}</span>
    ) },
    { key: 'response_status', header: 'Attendance', sort: (r) => r.response_status, cell: (r) => {
      const cls = r.response_status === 'attended'
        ? 'bg-emerald-100 text-emerald-700'
        : r.response_status === 'missed'
          ? 'bg-slate-100 text-slate-600'
          : 'bg-amber-100 text-amber-700';
      const label = r.response_status === 'attended' ? 'Attended' : r.response_status === 'missed' ? 'Missed' : 'Awaiting';
      return <span className={`badge ${cls}`}>{label}</span>;
    } },
    { key: 'rating', header: 'Rating', sort: (r) => r.rating ?? 0, cell: (r) => (
      r.attended && r.rating ? (
        <span className="inline-flex items-center gap-0.5 font-medium text-slate-700">
          {r.rating}<Star size={13} className="fill-brand-gold text-brand-gold" />
        </span>
      ) : (
        <span className="text-slate-400">—</span>
      )
    ) },
    { key: 'responded_at', header: 'Submitted', sort: (r) => r.responded_at ?? '', cell: (r) => (
      <span className="text-slate-500">{r.responded_at ? fmtDate(r.responded_at) : '—'}</span>
    ) },
  ];

  const TABS: { key: AdminTab; label: string }[] = [
    { key: 'classes', label: 'Classes' },
    { key: 'attendance', label: 'Class Attendance' },
  ];

  return (
    <div>
      <PageHeader
        title="Community Class Management"
        description="Join requests, community class moderation, and post-class attendance."
        actions={tab === 'classes' ? (
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreating(true)}>
            <Plus size={16} />
            New community class
          </button>
        ) : undefined}
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${tab === t.key ? 'border-b-2 border-brand text-brand' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'classes' && (
        <>
      <h2 className="mt-6 flex flex-wrap items-center gap-2 text-lg font-bold">
        Community Class Join Requests
        {!!joinReqs.data?.length && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            {joinReqs.data.length} pending
          </span>
        )}
      </h2>
      <p className="mb-3 mt-1 text-sm text-slate-500">Pending requests to join community classes, across every group. Approving adds the member on the owner's behalf.</p>
      <DataTable
        rows={joinReqs.data}
        columns={joinColumns}
        loading={joinReqs.isLoading}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.requester_name} ${r.requester_student_id} ${r.team_name}`}
        searchPlaceholder="Search requester / community class"
        initialSort={{ key: 'created_at', dir: 'desc' }}
        emptyLabel="No pending join requests."
      />

      <h2 className="mt-8 text-lg font-bold">Community Classes</h2>
      <p className="mb-3 mt-1 text-sm text-slate-500">All active community classes. Open chat to moderate any group; deleting removes it for every member.</p>
      <DataTable
        rows={teams.data}
        columns={teamColumns}
        loading={teams.isLoading}
        rowKey={(t) => t.id}
        searchText={(t) => `${t.name} ${t.owner_student_id} ${t.description ?? ''}`}
        searchPlaceholder="Search community class / owner"
        initialSort={{ key: 'updated_at', dir: 'desc' }}
        emptyLabel="No community classes."
      />
        </>
      )}

      {tab === 'attendance' && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-brand/10 p-2 text-brand">
                <ClipboardCheck size={18} />
              </span>
              <div>
                <h2 className="font-bold text-slate-800">Student class attendance</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Per-student records from the post-class check-in (shown 24h after each session).
                </p>
              </div>
            </div>
            <select
              className="input w-auto min-w-[10rem]"
              value={attendanceFilter}
              onChange={(e) => setAttendanceFilter(e.target.value as AttendanceFilter)}
            >
              <option value="all">All records</option>
              <option value="submitted">Submitted only</option>
              <option value="pending">Awaiting response</option>
            </select>
          </div>
          <DataTable
            rows={attendance.data}
            columns={attendanceColumns}
            loading={attendance.isLoading}
            rowKey={(r) => r.id}
            searchText={(r) => `${r.student_name} ${r.student_id} ${r.team_name} ${r.session_date}`}
            searchPlaceholder="Search student / community class / date"
            initialSort={{ key: 'session_date', dir: 'desc' }}
            emptyLabel="No attendance records yet."
          />
        </>
      )}

      {creating && (
        <CommunityClassModal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['admin-community-teams'] });
          }}
        />
      )}

      {editingTeam && (
        <CommunityClassModal
          team={editingTeam}
          onClose={() => setEditingTeam(null)}
          onDone={() => {
            setEditingTeam(null);
            qc.invalidateQueries({ queryKey: ['admin-community-teams'] });
          }}
        />
      )}

      {ratingsTeam && (
        <ClassRatingsModal team={ratingsTeam} onClose={() => setRatingsTeam(null)} />
      )}

      {membersTeam && (
        <TeamMembersModal
          teamId={membersTeam.id}
          teamName={membersTeam.name}
          maxMembers={membersTeam.max_members}
          adminView
          removingId={removingId}
          onClose={() => { setMembersTeam(null); setRemovingId(null); }}
          onRemove={(m) => {
            const name = m.display_name || m.first_name || m.student_id;
            if (window.confirm(`Remove ${name} from “${membersTeam.name}”?`)) {
              removeMember.mutate({ teamId: membersTeam.id, studentId: m.student_id });
            }
          }}
        />
      )}
    </div>
  );
}
