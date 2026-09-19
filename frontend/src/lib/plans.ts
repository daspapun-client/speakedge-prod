import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';

export interface PlanPrice {
  plan: string;
  amount: number;
  offer_price: number | null;
  monthly_fee: number;
}

/**
 * Catalogue rows that are sold somewhere other than the membership page (the
 * Basic English Course lives under Books). Everything else the API returns is a
 * membership and is shown publicly.
 *
 * This is an exclusion list rather than an allowlist of the tiers we shipped
 * with on purpose: an allowlist meant a plan an admin added from Admin ->
 * Subscription Plans was fetched and then silently dropped by the browser.
 */
export const NON_MEMBERSHIP_PLAN_KEYS = ['Basic English Course'];

const NON_MEMBERSHIP_PLAN_SET = new Set<string>(NON_MEMBERSHIP_PLAN_KEYS);

/** True for every plan that belongs on /plans, custom admin ones included. */
export const isMembershipPlan = (plan: string) => !NON_MEMBERSHIP_PLAN_SET.has(plan);

/** One-time admission / membership fee charged at checkout (paise). */
export const admissionOf = (p: PlanPrice) => (p.offer_price != null ? p.offer_price : p.amount);

export const planRupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export function lowestAdmissionPaise(plans: PlanPrice[]): number | null {
  const prices = plans
    .filter((p) => isMembershipPlan(p.plan))
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
