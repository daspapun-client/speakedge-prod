/**
 * Shared partner vocabulary — the lead ladder, the report types and the
 * performance shapes the backend aggregates, so the partner dashboard, the
 * admin screens and the public pages all speak the same language.
 *
 * The one rule worth remembering while reading these types: **only admin
 * approved reports reach any total**. `pending_approval_reports` is what is
 * still in flight; everything else is settled.
 */
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { downloadExport } from '@/features/admin/_shared';

export const LEAD_STATUSES = [
  'new', 'contacted', 'demo_registered', 'admission_pending', 'converted', 'lost',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'New Lead',
  contacted: 'Contacted',
  demo_registered: 'Demo Registered',
  admission_pending: 'Admission Pending',
  converted: 'Converted',
  lost: 'Lost',
};

export const REPORT_TYPES = [
  'book_sale', 'course_admission', 'membership_sale', 'student_registration',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABELS: Record<string, string> = {
  book_sale: 'Book Sales',
  course_admission: 'Course Admissions',
  membership_sale: 'Membership Sales',
  student_registration: 'Student Registrations',
};

export const PARTNER_STATUSES = [
  'pending', 'under_review', 'approved', 'rejected', 'on_hold', 'suspended',
];

export const PARTNER_TYPES = [
  'Educational Institute Partner',
  'Complete Sujyoti Franchisee Partner',
  'Book Store / Shop Partner',
  'Individual Partner',
];

export const FRANCHISEE_TYPE = 'Complete Sujyoti Franchisee Partner';

export interface PartnerLead {
  id: string;
  partner_id: string;
  partner_name?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  interest?: string | null;
  status: LeadStatus;
  status_label?: string;
  notes?: string | null;
  location?: string | null;
  source: string;
  history: { at: string; by: string; from?: string | null; to?: string | null; note?: string | null }[];
  created_at: string;
}

export interface PartnerReport {
  id: string;
  partner_id: string;
  partner_name?: string | null;
  report_type: ReportType;
  label?: string;
  product?: string | null;
  quantity: number;
  amount?: number | null;
  remarks?: string | null;
  status: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_remarks?: string | null;
  occurred_on?: string | null;
  created_at: string;
}

export interface PerformanceTotals {
  total_leads: number;
  leads_by_status: Record<string, number>;
  converted_leads: number;
  total_book_sales: number;
  total_admissions: number;
  total_membership_sales: number;
  total_student_registrations: number;
  total_book_orders: number;
  revenue_paise: number;
  approved_reports: number;
  pending_approval_reports: number;
  rejected_reports: number;
}

export interface ProductRow {
  product: string;
  quantity: number;
  revenue_paise: number;
  reports: number;
}

export interface TypeRow extends Omit<ProductRow, 'product'> {
  report_type: string;
  label: string;
}

export interface PeriodRow {
  period: string;
  quantity: number;
  revenue_paise: number;
  reports: number;
  book_sale: number;
  course_admission: number;
  membership_sale: number;
  student_registration: number;
}

export interface Performance {
  totals: PerformanceTotals;
  by_product: ProductRow[];
  by_type: TypeRow[];
  monthly: PeriodRow[];
  yearly: PeriodRow[];
}

export interface PartnerProfile {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  area?: string | null;
  district?: string | null;
  state?: string | null;
  about?: string | null;
}

export interface PartnerDashboard {
  id: string;
  partner_id?: string | null;
  name: string;
  org?: string | null;
  partner_type: string;
  status: string;
  products_allowed: string[];
  interested_in: string[];
  remarks?: string | null;
  profile: PartnerProfile;
  public_visible: boolean;
  microsite_slug?: string | null;
  microsite_published: boolean;
  microsite_url?: string | null;
  joined_at: string;
  performance: PerformanceTotals;
  by_product: ProductRow[];
  by_type: TypeRow[];
  monthly: PeriodRow[];
}

export function usePartnerDashboard() {
  return useQuery({
    queryKey: ['partner-dashboard'],
    queryFn: () => unwrap<PartnerDashboard>(api.get('/partner/dashboard')),
  });
}

export function usePartnerPerformance(year?: string) {
  return useQuery({
    queryKey: ['partner-performance', year ?? ''],
    queryFn: () => unwrap<Performance>(
      api.get('/partner/me/performance', { params: { year: year || undefined } })),
  });
}

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export const EXPORT_FORMATS: ExportFormat[] = ['csv', 'xlsx', 'pdf'];

/** "2026-03" -> "Mar 2026"; a bare year is passed through. */
export function periodLabel(period: string) {
  if (/^\d{4}$/.test(period)) return period;
  const [y, m] = period.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return Number.isNaN(d.getTime())
    ? period
    : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/** Download one of the partner's own report datasets. */
export function downloadPartnerReport(
  dataset: string, format: ExportFormat, year?: string,
) {
  return downloadExport('/partner/me/export', { dataset, format, year: year || undefined },
    `partner_${dataset}.${format}`);
}
