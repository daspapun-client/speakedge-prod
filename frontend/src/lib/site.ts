import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from './api';

/**
 * Public contact details, in one place so the footer, legal pages and support
 * widget never drift apart. The social / Google Business Profile links are NOT
 * here — they are admin-editable and come from the API (`useSiteLinks` below).
 */
export const CONTACT_PHONE = '82408 61168';
export const CONTACT_PHONE_E164 = '918240861168';
export const WHATSAPP_URL = `https://wa.me/${CONTACT_PHONE_E164}`;
export const TEL_URL = `tel:+${CONTACT_PHONE_E164}`;
export const SUPPORT_EMAIL = 'support@sujyotiedtech.com';
export const SUPPORT_EMAIL_URL = `mailto:${SUPPORT_EMAIL}`;

/** Registered office, one line per row as it should be printed. */
export const OFFICE_ADDRESS = [
  'Sujyoti EdTech Pvt. Ltd.',
  'Madhyamgram, Kolkata – 700130',
  'West Bengal, India',
];

export const SUPPORT_HOURS = 'Daily, 10:00 AM – 9:00 PM IST (UTC+5:30)';

/**
 * The Sujyoti EdTech corporate partner page. The partner ecosystem is shared
 * across every Sujyoti product, so the spec routes SpeakEdge's partner links
 * there rather than to the SpeakEdge directory.
 *
 * TODO: set the real corporate URL. While it is empty, `partnerHref()` falls
 * back to the in-app partner directory so nothing is broken in the meantime.
 */
export const CORPORATE_PARTNER_URL = '';

/** Where a "Partner" link should point, and whether it leaves the site. */
export function partnerHref(): { href: string; external: boolean } {
  return CORPORATE_PARTNER_URL
    ? { href: CORPORATE_PARTNER_URL, external: true }
    : { href: '/partners', external: false };
}

export interface SocialLink {
  /** Slug that picks the footer icon; unknown keys render a generic globe. */
  key: string;
  label: string;
  url: string;
}

/**
 * Google Business Profile + social media links.
 *
 * These are **admin-editable** (Admin -> Site Links) rather than hard-coded,
 * because the real URLs only exist once SpeakEdge is live — they can be added
 * or changed later with no code change. The endpoint returns only the profiles
 * that actually have a URL, so nothing is rendered until they are filled in.
 */
export function useSiteLinks(): SocialLink[] {
  const { data } = useQuery({
    queryKey: ['site-links'],
    queryFn: () => unwrap<{ links: SocialLink[] }>(api.get('/site/links')),
    staleTime: 5 * 60 * 1000,
  });
  return data?.links ?? [];
}
