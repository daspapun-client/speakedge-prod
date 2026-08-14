/** API timestamps are UTC; backend/Mongo often omit the trailing Z. */
export function parseApiDate(iso: string): Date {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(iso)) return new Date(iso);
  return new Date(`${iso}Z`);
}

const IST_TZ = 'Asia/Kolkata';

/** Calendar date YYYY-MM-DD in IST — matches backend batch scheduling. */
export function todayIsoIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ }).format(new Date());
}

/** Current clock time HH:MM in IST (24h). */
export function nowHmIST(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

export function isInSlot(now: string, start: string, end: string): boolean {
  return start <= now && now <= end;
}

export function isSlotEnded(now: string, end: string): boolean {
  return now > end;
}

export function isSlotUpcoming(now: string, start: string): boolean {
  return now < start;
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  return parseApiDate(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "21:55" → "9:55 PM" */
export function fmtHm12(hm: string): string {
  const [h, m] = hm.trim().split(':').map(Number);
  if (Number.isNaN(h)) return hm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, '0')} ${ampm}`;
}

export function parseSlotRange(classTime?: string | null): { start: string; end: string } | null {
  if (!classTime) return null;
  const m = classTime.match(/^(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})$/);
  if (!m) return null;
  return { start: m[1], end: m[2] };
}

/** "21:55–23:55" → "9:55 PM – 11:55 PM" */
export function fmtSlotRange(classTime?: string | null): string | null {
  const slot = parseSlotRange(classTime);
  if (!slot) return classTime?.trim() || null;
  return `${fmtHm12(slot.start)} – ${fmtHm12(slot.end)}`;
}

export function relTime(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - parseApiDate(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return parseApiDate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
