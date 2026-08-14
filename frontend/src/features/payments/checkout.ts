import { api, unwrap } from '@/lib/api';

interface OrderResult {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  payment_ref: string;
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

/**
 * Create an order, open Razorpay checkout, and verify server-side.
 * When live keys are not configured the backend returns a test order
 * (order_test_*) which we verify directly — so the flow is fully demoable.
 */
export async function startCheckout(opts: {
  plan?: string;
  kind?: string;
  amount?: number;
  months?: number;
  /** Terms & Conditions acceptance — the backend rejects the order without it. */
  accept_terms: boolean;
}) {
  const order = await unwrap<OrderResult>(api.post('/payments/order', opts));
  await payOrder(order, opts.plan ? `${opts.plan} subscription` : 'SpeakEdge purchase');
}

/** Pay the next monthly fee (amount and due month are resolved server-side). */
export async function startMonthlyCheckout() {
  const order = await unwrap<OrderResult & { due_month: string }>(
    api.post('/payments/monthly-order', {}),
  );
  await payOrder(order, `Monthly fee — ${order.due_month}`);
}

/** No real keys configured — the backend issues order_test_* ids it accepts
 *  without a signature, so the whole flow stays demoable offline. */
function isDemoOrder(order: OrderResult): boolean {
  return !order.key_id || order.key_id.includes('xxxx') || order.order_id.startsWith('order_test_');
}

async function payOrder(order: OrderResult, description: string) {
  if (isDemoOrder(order)) {
    await unwrap(
      api.post('/payments/verify', {
        razorpay_order_id: order.order_id,
        razorpay_payment_id: `pay_test_${Date.now()}`,
        razorpay_signature: 'test',
      }),
    );
    alert('Payment successful (test mode). Invoice is in your dashboard.');
    return;
  }

  if (!(await loadRazorpay()) || !window.Razorpay) {
    alert('Could not load the payment gateway. Check your connection and try again.');
    return;
  }

  // Settle only once the gateway is done, so callers refresh after payment.
  // Cancel/failure resolve too — callers treat this as fire-and-forget.
  await new Promise<void>((resolve) => {
    const rzp = new window.Razorpay!({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: 'SpeakEdge',
      description,
      theme: { color: '#1e3a8a' },
      handler: async (resp: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        try {
          await unwrap(api.post('/payments/verify', resp));
          alert('Payment verified. Invoice is available in your dashboard.');
        } catch {
          alert('Payment taken but not yet confirmed. It will be reconciled shortly.');
        }
        resolve();
      },
      modal: { ondismiss: () => resolve() },
    });
    rzp.on?.('payment.failed', () => {
      alert('Payment failed. Nothing was charged — please try again.');
      resolve();
    });
    rzp.open();
  });
}
