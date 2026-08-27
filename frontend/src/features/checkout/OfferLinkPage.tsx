import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';

/**
 * The landing page of a New Student Offer link (`/offer/:token`), the URL admin
 * sends a prospect over WhatsApp or email.
 *
 * Its whole job is to decide where the visitor goes. A live link hands them to
 * the ordinary guest checkout with the offer applied; an expired, revoked or
 * unknown one (all a 404 from the API — a lapsed offer discloses nothing) sends
 * them to the regular Membership Plans page at the regular prices, which is the
 * spec's stated behaviour after expiry.
 */

interface Offer {
  token: string;
  plan: string;
}

export function OfferLinkPage() {
  const { token = '' } = useParams();

  const { data, isPending } = useQuery({
    queryKey: ['admission-offer', token],
    queryFn: () => unwrap<Offer>(api.get(`/payments/admission-offers/${token}`)),
    enabled: !!token,
    retry: false,
  });

  if (token && isPending) {
    return <p className="py-16 text-center text-slate-500">Opening your offer…</p>;
  }
  if (!data) return <Navigate to="/plans" replace />;
  return (
    <Navigate
      replace
      to={`/checkout?plan=${encodeURIComponent(data.plan)}&offer=${encodeURIComponent(token)}`}
    />
  );
}
