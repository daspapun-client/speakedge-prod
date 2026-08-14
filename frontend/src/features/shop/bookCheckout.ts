import { loadRazorpay } from '@/features/payments/checkout';
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
  currency: string;
  key_id: string;
}

/**
 * Create a book order and (when real keys are configured) open Razorpay.
 * Book payments are reconciled server-side via the Razorpay webhook — there is
 * no guest verify endpoint — so we resolve as soon as the order exists and the
 * gateway popup is dismissed. The caller shows the confirmation + tracking.
 */
export async function bookCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const order = await unwrap<CheckoutResult>(api.post('/books/checkout', input));

  // Same rule as the backend's keys_configured(): the placeholder key means
  // offline demo mode, where the order is reconciled without the gateway.
  const testKeys = !order.key_id.startsWith('rzp_') || order.key_id.includes('xxxx');
  const loaded = testKeys ? false : await loadRazorpay();

  if (loaded && window.Razorpay) {
    await new Promise<void>((resolve) => {
      const rzp = new window.Razorpay!({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: 'SpeakEdge',
        description: `Book order ${order.order_number}`,
        prefill: { name: input.buyer_name, contact: input.phone, email: input.email },
        // Reconciliation happens via the webhook; we just close the flow.
        handler: () => resolve(),
        modal: { ondismiss: () => resolve() },
      });
      rzp.open();
    });
  }

  return order;
}
