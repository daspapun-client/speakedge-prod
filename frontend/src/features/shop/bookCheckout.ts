import { isDemoOrder, loadRazorpay } from '@/features/payments/checkout';
import { api, unwrap } from '@/lib/api';

export interface CheckoutInput {
  buyer_name: string;
  phone: string;
  delivery_type: 'home' | 'office';
  product_id?: string;
  plan?: string;    // membership bundled in (SpeakEdge Book route)
  months?: number;  // membership validity term (does not affect price)
  email?: string;
  alt_phone?: string;
  address_line1?: string;
  address_line2?: string;
  landmark?: string;
  state?: string;
  district?: string;
  city?: string;
  pin_code?: string;
  delivery_instructions?: string;
  /** Pay the plan's first monthly fee together with the admission fee. */
  include_first_month?: boolean;
  /** New-student offer link the buyer arrived on. The server re-checks it and
   *  charges the offer price in place of the catalogue admission fee. */
  offer?: string;
  /** Terms & Conditions acceptance. The backend refuses the order without it. */
  accept_terms: boolean;
}

export interface CheckoutResult {
  order_number: string;
  book_order_id: string;
  order_id: string;
  amount: number;
  book_amount: number;
  delivery_charge: number;
  gst_amount: number;
  plan: string | null;
  plan_months: number | null;
  plan_amount: number;
  first_month_amount: number;
  currency: string;
  key_id: string;
  /** True once Razorpay payment is verified server-side (or demo auto-verify). */
  paid?: boolean;
  /** Present once paid, on membership orders only — the buyer's next step. */
  activation_code?: string | null;
}

interface VerifyResult {
  status: string;
  order_number: string;
  paid: boolean;
  activation_code: string | null;
  order_status: string;
}

async function verifyBookPayment(
  order: CheckoutResult,
  phone: string,
  resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
): Promise<VerifyResult> {
  return unwrap<VerifyResult>(
    api.post('/books/verify-payment', {
      order_number: order.order_number,
      phone,
      ...resp,
    }),
  );
}

/**
 * Reopen an order the buyer abandoned at the gateway. The backend issues a
 * fresh Razorpay order against the same BookOrder, so they keep their order
 * number, address and the copy held for them.
 */
export async function resumeBookPayment(
  order_number: string,
  phone: string,
): Promise<CheckoutResult> {
  const order = await unwrap<CheckoutResult>(
    api.post('/books/resume-payment', { order_number, phone }),
  );
  return payBookOrder(order, phone, order.plan ? 'Membership order' : 'Book order');
}

/**
 * Create a book order, open Razorpay when live keys are configured, and verify
 * payment server-side so guest buyers get immediate confirmation without a
 * student session or webhook (webhook remains the backup reconciler in prod).
 */
export async function bookCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const order = await unwrap<CheckoutResult>(api.post('/books/checkout', input));
  return payBookOrder(
    order,
    input.phone,
    `Book order ${order.order_number}`,
    { name: input.buyer_name, email: input.email },
  );
}

/** Runs the gateway for an existing book order and verifies it server-side. */
async function payBookOrder(
  order: CheckoutResult,
  phone: string,
  description: string,
  prefill: { name?: string; email?: string } = {},
): Promise<CheckoutResult> {
  if (isDemoOrder(order)) {
    const res = await verifyBookPayment(order, phone, {
      razorpay_order_id: order.order_id,
      razorpay_payment_id: `pay_test_${Date.now()}`,
      razorpay_signature: 'test',
    });
    return { ...order, paid: true, activation_code: res.activation_code };
  }

  if (!(await loadRazorpay()) || !window.Razorpay) {
    throw new Error('Could not load the payment gateway. Check your connection and try again.');
  }

  let paid = false;
  let activationCode: string | null = null;
  await new Promise<void>((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: 'SpeakEdge',
      description,
      theme: { color: '#1e3a8a' },
      prefill: { name: prefill.name, contact: phone, email: prefill.email },
      handler: async (resp: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        try {
          const res = await verifyBookPayment(order, phone, resp);
          activationCode = res.activation_code;
          paid = true;
        } catch (err) {
          reject(err);
          return;
        }
        resolve();
      },
      modal: {
        ondismiss: () => {
          if (!paid) {
            reject(
              new Error(
                `Payment was cancelled. Your order ${order.order_number} was saved — ` +
                  'you can finish paying from the Track Order page.',
              ),
            );
          } else resolve();
        },
      },
    });
    rzp.on?.('payment.failed', () => {
      reject(new Error('Payment failed. Nothing was charged — please try again.'));
    });
    rzp.open();
  });

  return { ...order, paid, activation_code: activationCode };
}
