import { useQuery } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Award, ArrowRight, Download, FileText, FolderOpen, Receipt, type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, rupees } from '@/features/admin/_shared';

interface ExamDownload {
  url?: string | null;
  code: string;
  remarks?: string | null;
  examiner_name?: string | null;
  exam_date?: string | null;
}

interface Downloads {
  certificates: (ExamDownload & { id: string; title: string; grade?: string | null })[];
  report_cards: (ExamDownload & { id: string; level: string })[];
  invoices: { invoice_no?: string | null; url?: string | null; amount: number }[];
}

/** "12 Sep 2026 · Rina Sen" — whichever parts the result actually carries. */
function examSubtitle(d: ExamDownload) {
  const parts = [
    d.exam_date ? new Date(d.exam_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
    d.examiner_name,
    `Code · ${d.code}`,
  ];
  return parts.filter(Boolean).join(' · ');
}

function StatTile({ label, value, icon: Icon, hint }: { label: string; value: number | string; icon: LucideIcon; hint?: string }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-extrabold text-brand">{value}</div>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function ReportsSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-64 rounded bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-200" />)}
      </div>
      {[1, 2, 3].map((i) => <div key={i} className="h-40 rounded-xl bg-slate-200" />)}
    </div>
  );
}

function EmptyBlock({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Icon size={22} />
      </div>
      <p className="mt-3 font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      {action && (
        <Link to={action.to} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-light">
          {action.label} <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}

function DownloadCard({
  title,
  subtitle,
  note,
  icon: Icon,
  url,
  to,
  accent = 'brand',
}: {
  title: string;
  subtitle: string;
  /** Examiner remarks, shown under the title when the result carries them. */
  note?: string | null;
  icon: LucideIcon;
  url?: string | null;
  /** In-app page for the document, where it has one — preferred over the PDF. */
  to?: string;
  accent?: 'brand' | 'gold' | 'emerald';
}) {
  const iconBg = accent === 'gold' ? 'bg-brand-gold/15 text-brand-gold' : accent === 'emerald' ? 'bg-emerald-100 text-emerald-600' : 'bg-brand/10 text-brand';

  return (
    <div className="group card flex items-center justify-between gap-4 transition hover:border-brand hover:shadow-md">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`shrink-0 rounded-xl p-2.5 ${iconBg}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-800 group-hover:text-brand">{title}</div>
          <div className="mt-0.5 truncate text-xs text-slate-400">{subtitle}</div>
          {note && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{note}</p>}
        </div>
      </div>
      {to ? (
        <Link to={to} className="btn-ghost shrink-0 py-2" title="Open">
          <ArrowRight size={16} /> <span className="hidden sm:inline">Open</span>
        </Link>
      ) : url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost shrink-0 py-2"
          title="Download"
        >
          <Download size={16} /> <span className="hidden sm:inline">Download</span>
        </a>
      ) : (
        <span className="shrink-0 text-xs text-slate-400">Unavailable</span>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-brand/10 p-2 text-brand">
            <Icon size={18} />
          </span>
          <div>
            <h2 className="font-bold text-slate-800">{title}</h2>
            <p className="text-xs text-slate-400">{count} file{count === 1 ? '' : 's'} available</p>
          </div>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['downloads'],
    queryFn: () => unwrap<Downloads>(api.get('/dashboard/downloads')),
  });

  if (isLoading) return <ReportsSkeleton />;

  const certs = data?.certificates ?? [];
  const reports = data?.report_cards ?? [];
  const invoices = data?.invoices ?? [];
  const total = certs.length + reports.length + invoices.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Downloads"
        description="Certificates, CEFR report cards, and payment invoices — all in one place"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Certificates" value={certs.length} icon={Award} hint={certs.length ? 'Speaking achievements' : 'Earn by passing tests'} />
        <StatTile label="Report cards" value={reports.length} icon={FileText} hint={reports.length ? 'CEFR assessments' : 'Take a CEFR test'} />
        <StatTile label="Invoices" value={invoices.length} icon={Receipt} hint={invoices.length ? 'Payment receipts' : 'Generated after payment'} />
      </div>

      {total > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-5 text-white sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white/80">Your download centre</p>
                <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">{total} document{total === 1 ? '' : 's'} ready</h2>
                <p className="mt-1 text-sm text-white/70">PDFs open in a new tab — save or print from your browser</p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <FolderOpen size={28} />
              </div>
            </div>
          </div>
        </div>
      )}

      <Section title="Certificates" icon={Award} count={certs.length}>
        {!certs.length ? (
          <EmptyBlock
            icon={Award}
            title="No certificates yet"
            description="Pass a Speaking test to earn your first certificate."
            action={{ to: '/dashboard/exams', label: 'View exams' }}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {certs.map((c) => (
              <DownloadCard
                key={c.code}
                title={c.title}
                subtitle={examSubtitle(c)}
                note={c.remarks}
                icon={Award}
                url={c.url}
                to={c.id ? `/dashboard/certificate/${c.id}` : undefined}
                accent="gold"
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="CEFR Report Cards" icon={FileText} count={reports.length}>
        {!reports.length ? (
          <EmptyBlock
            icon={FileText}
            title="No report cards yet"
            description="Complete a CEFR assessment to receive your level report."
            action={{ to: '/dashboard/exams', label: 'View exams' }}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {reports.map((r) => (
              <DownloadCard
                key={r.code}
                title={`CEFR Level ${r.level}`}
                subtitle={examSubtitle(r)}
                note={r.remarks}
                icon={FileText}
                url={r.url}
                to={r.id ? `/dashboard/report/${r.id}` : undefined}
                accent="emerald"
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Invoices" icon={Receipt} count={invoices.length}>
        {!invoices.length ? (
          <EmptyBlock
            icon={Receipt}
            title="No invoices yet"
            description="Invoices are generated automatically after successful payments."
            action={{ to: '/dashboard/payments', label: 'View payments' }}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {invoices.map((inv, i) => (
              <DownloadCard
                key={inv.invoice_no ?? i}
                title={inv.invoice_no ?? 'Invoice'}
                subtitle={rupees(inv.amount)}
                icon={Receipt}
                url={inv.url}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
