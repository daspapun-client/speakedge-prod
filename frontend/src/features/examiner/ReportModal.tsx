/**
 * The examiner's report form — a CEFR Test Report or a Speaking Test Result,
 * chosen by the booked slot's kind. Submitting publishes the student's report
 * card / certificate and records the exam date, examiner name and remarks for
 * the admin result views.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertCircle, CalendarClock, Clock, Loader2 } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { Modal, StudentAvatar } from '@/features/admin/_shared';
import {
  CEFR_LEVELS, CEFR_SKILLS, SPEAKING_GRADES, fmtSlot, slotWindow,
  type AssignedBooking,
} from '@/features/exams/shared';

/** 0–10 per sub-skill, matching the score grid printed on the report card. */
const SCORE_CHOICES = Array.from({ length: 11 }, (_, i) => i);

function LevelPicker({ value, onChange }: { value: string; onChange: (level: string) => void }) {
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {CEFR_LEVELS.map((c) => (
        <button
          key={c}
          type="button"
          className={`btn-ghost px-4 py-1.5 text-sm font-semibold ${value === c ? 'bg-brand text-white hover:bg-brand' : ''}`}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

export function ReportModal({ booking, onClose, onDone }: {
  booking: AssignedBooking;
  onClose: () => void;
  onDone: () => void;
}) {
  const kind = booking.kind ?? 'CEFR';
  const isCefr = kind === 'CEFR';
  // On a Speaking test the level is the one printed on the CEFR-aligned
  // certificate, so it starts from the student's current level rather than a
  // fixed default.
  const [level, setLevel] = useState(isCefr ? 'B1' : booking.student_cefr_level || 'B1');
  const [grade, setGrade] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const submit = useMutation({
    mutationFn: () => {
      if (!isCefr && !grade.trim()) throw new Error('Grade / result is required');
      return unwrap<Record<string, unknown>>(api.post('/exams/report', {
        exam_booking_id: booking.id,
        student_id: booking.student_id,
        level: isCefr ? level : null,
        cefr_level: isCefr ? null : level,
        grade: isCefr ? null : grade.trim(),
        scores: isCefr ? scores : {},
        remarks: remarks.trim() || null,
      }));
    },
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <StudentAvatar
            photoUrl={booking.student_photo_url}
            gender={booking.student_gender}
            name={booking.student_name ?? booking.student_id}
            size="h-11 w-11"
          />
          <div className="min-w-0">
            <h2 className="text-lg font-bold">
              {isCefr ? 'CEFR Test Report' : 'Speaking Test Result'}
            </h2>
            <p className="truncate text-sm text-slate-600">
              {booking.student_name ?? booking.student_id}
            </p>
            <p className="font-mono text-xs text-slate-400">{booking.student_id}</p>
          </div>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>

      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm sm:grid-cols-2">
        <div className="font-semibold text-slate-700">{booking.exam_title}</div>
        <div className="text-slate-500">{kind} test</div>
        <div className="inline-flex items-center gap-1.5 text-slate-600">
          <CalendarClock size={14} className="shrink-0 text-brand" />
          {fmtSlot(booking.scheduled_at) ?? 'Date not set'}
        </div>
        <div className="inline-flex items-center gap-1.5 text-slate-600">
          <Clock size={14} className="shrink-0 text-brand" />
          {slotWindow(booking.scheduled_at, booking.duration_minutes)}
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-4 space-y-4">
        {isCefr ? (
          <>
            <div>
              <label className="label">CEFR level awarded</label>
              <LevelPicker value={level} onChange={setLevel} />
            </div>
            <div>
              <label className="label">Skill scores (out of 10) — printed on the report card</label>
              <div className="mt-1 grid gap-3 sm:grid-cols-2">
                {CEFR_SKILLS.map((skill) => (
                  <div key={skill}>
                    <span className="text-xs font-medium capitalize text-slate-500">{skill}</span>
                    <select
                      className="input mt-1"
                      value={scores[skill] ?? ''}
                      onChange={(e) => setScores((s) => {
                        const next = { ...s };
                        if (e.target.value === '') delete next[skill];
                        else next[skill] = Number(e.target.value);
                        return next;
                      })}
                    >
                      <option value="">Not scored</option>
                      {SCORE_CHOICES.map((n) => <option key={n} value={n}>{n} / 10</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="label">Grade / result</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {SPEAKING_GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`btn-ghost px-4 py-1.5 text-sm font-semibold ${grade === g ? 'bg-brand text-white hover:bg-brand' : ''}`}
                    onClick={() => setGrade(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <input
                className="input mt-2"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="Or type the result, e.g. Distinction"
              />
            </div>
            <div>
              <label className="label">CEFR level achieved — printed on the certificate</label>
              <LevelPicker value={level} onChange={setLevel} />
            </div>
          </>
        )}

        <div>
          <label className="label">Remarks {isCefr ? '' : '(optional)'}</label>
          <textarea
            className="input"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Feedback shared with the student and visible to admin"
          />
        </div>

        <p className="text-xs text-slate-500">
          {isCefr
            ? 'Publishing generates the CEFR report card and marks the student’s community profile as Verified.'
            : 'Publishing generates the certificate and stores it in the student’s dashboard.'}{' '}
          This cannot be submitted twice for the same booking.
        </p>

        <button
          className="btn-primary w-full"
          disabled={submit.isPending || (!isCefr && !grade.trim())}
          onClick={() => submit.mutate()}
        >
          {submit.isPending
            ? <><Loader2 size={16} className="animate-spin" /> Publishing…</>
            : isCefr ? 'Publish report card' : 'Publish certificate'}
        </button>
      </div>
    </Modal>
  );
}
