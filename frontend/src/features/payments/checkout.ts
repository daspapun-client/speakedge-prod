import { api, unwrap } from '@/lib/api';

interface OrderResult {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  payment_ref: string;
  /** Server-side breakdown of `amount`; the client never computes the price. */
  plan_amount?: number;
  first_month_amount?: number;
  book_amount?: number;
  gst_amount?: number;
  delivery_charge?: number;
}

/** Contact + address captured on the membership checkout page — the same
 *  fields the book checkout collects. Stored on the Payment as the billing
 *  record; it never affects the price (that is resolved from PlanConfig). */
export interface BillingDetails {
  name: string;
  phone: string;
  alt_phone?: string;
  email?: string;
  address_line1?: string;
  address_line2?: string;
  landmark?: string;
  city?: string;
  district?: string;
  state?: string;
  pin_code?: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on?: (event: string, cb: (resp: unknown) => void) => void;
    };
  }
}

/** Injects the Razorpay checkout script once; false if it could not load. */
export function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export interface SubscriptionCheckoutInput {
  plan: string;
  /** Subscription validity only — the price comes from PlanConfig server-side. */
  months?: number;
  /** Terms & Conditions acceptance — the backend rejects the order without it. */
  accept_terms: boolean;
  /** Pay the plan's first monthly fee together with the admission fee. */
  include_first_month?: boolean;
  /** Ship the SpeakEdge Book with the membership; omit for membership only. */
  delivery_type?: 'home' | 'office';
  /** Upgrades only: "YYYY-MM-DD" the upgraded membership takes over (within 30
   *  days). Omitted = as soon as the payment lands. */
  activate_on?: string;
  /** Dashboard exclusive offer id — the server prices the order from it. */
  offer?: string;
  billing?: BillingDetails;
}

/**
 * Create an order, open Razorpay checkout, and verify server-side. Resolves
 * `paid: true` once the payment is confirmed (the subscription is created by
 * the backend at that point) and `paid: false` if the buyer closed the gateway;
 * failures throw with a message the caller can render.
 */
export async function startSubscriptionCheckout(
  opts: SubscriptionCheckoutInput,
): Promise<{ paid: boolean; order_id: string; amount: number }> {
  const order = await unwrap<OrderResult>(api.post('/payments/order', opts));
  const paid = await payOrder(order, `${opts.plan} membership`, opts.billing);
  return { paid, order_id: order.order_id, amount: order.amount };
}

/**
 * One-click subscription payment for flows that jump straight to the gateway
 * (accepting a priced offer). Reports its own outcome — the caller only awaits
 * it to know the gateway is done.
 */
export async function startCheckout(opts: SubscriptionCheckoutInput) {
  try {
    if (await startSubscriptionCheckout(opts).then((r) => r.paid)) {
      alert('Payment verified. Invoice is available in your dashboard.');
    }
  } catch (err) {
    alert((err as Error).message);
  }
}

/** Pay the next monthly fee (amount and due month are resolved server-side). */
export async function startMonthlyCheckout() {
  const order = await unwrap<OrderResult & { due_month: string }>(
    api.post('/payments/monthly-order', {}),
  );
  try {
    if (await payOrder(order, `Monthly fee — ${order.due_month}`)) {
      alert('Payment verified. Invoice is available in your dashboard.');
    }
  } catch (err) {
    alert((err as Error).message);
  }
}

/** No real keys configured — the backend issues order_test_* ids it accepts
 *  without a signature, so the whole flow stays demoable offline. */
export function isDemoOrder(order: { key_id?: string; order_id: string }): boolean {
  return !order.key_id || order.key_id.includes('xxxx') || order.order_id.startsWith('order_test_');
}

/**
 * Runs the gateway for an already-created order and verifies it server-side.
 * True once the payment is confirmed, false if the buyer dismissed the gateway
 * without paying; anything that went wrong throws a user-facing message.
 */
async function payOrder(
  order: OrderResult,
  description: string,
  billing?: BillingDetails,
): Promise<boolean> {
  if (isDemoOrder(order)) {
    await unwrap(
      api.post('/payments/verify', {
        razorpay_order_id: order.order_id,
        razorpay_payment_id: `pay_test_${Date.now()}`,
        razorpay_signature: 'test',
      }),
    );
    return true;
  }

  if (!(await loadRazorpay()) || !window.Razorpay) {
    throw new Error('Could not load the payment gateway. Check your connection and try again.');
  }

  // Settles only once the gateway is done, so callers act after payment.
  return new Promise<boolean>((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: 'SpeakEdge',
      description,
      theme: { color: '#1e3a8a' },
      prefill: billing
        ? { name: billing.name, contact: billing.phone, email: billing.email }
        : undefined,
      handler: async (resp: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        try {
          await unwrap(api.post('/payments/verify', resp));
        } catch {
          reject(new Error('Payment taken but not yet confirmed. It will be reconciled shortly.'));
          return;
        }
        resolve(true);
      },
      modal: { ondismiss: () => resolve(false) },
    });
    rzp.on?.('payment.failed', () => {
      reject(new Error('Payment failed. Nothing was charged — please try again.'));
    });
    rzp.open();
  });
}
