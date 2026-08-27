import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';

export interface PlanPrice {
  plan: string;
  amount: number;
  offer_price: number | null;
  monthly_fee: number;
}

/** Membership tiers on /plans — not book-only or ad-hoc admin catalogue rows. */
export const MEMBERSHIP_PLAN_KEYS = [
  'Tribe',
  'Basic',
  'Silver',
  'Gold',
  'Diamond',
  'Silver Pro',
  'Gold Pro',
  'Diamond Pro',
] as const;

const MEMBERSHIP_PLAN_SET = new Set<string>(MEMBERSHIP_PLAN_KEYS);

/** One-time admission / membership fee charged at checkout (paise). */
export const admissionOf = (p: PlanPrice) => (p.offer_price != null ? p.offer_price : p.amount);

export const planRupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export function lowestAdmissionPaise(plans: PlanPrice[]): number | null {
  const prices = plans
    .filter((p) => MEMBERSHIP_PLAN_SET.has(p.plan))
    .map(admissionOf)
    .filter((paise) => paise > 0);
  if (!prices.length) return null;
  return Math.min(...prices);
}

export function usePublicPlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: () => unwrap<PlanPrice[]>(api.get('/payments/plans')),
  });
}

export function useLowestAdmissionPrice() {
  const { data: plans } = usePublicPlans();
  return useMemo(() => (plans ? lowestAdmissionPaise(plans) : null), [plans]);
}
