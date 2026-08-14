/**
 * Public contact + social profile links, in one place so the footer, legal
 * pages and support widget never drift apart.
 *
 * TODO: replace every '' below with the real profile URL. Any link left empty
 * is simply not rendered, so nothing broken ever ships.
 */
export const CONTACT_PHONE = '82408 61168';
export const CONTACT_PHONE_E164 = '918240861168';
export const WHATSAPP_URL = `https://wa.me/${CONTACT_PHONE_E164}`;
export const TEL_URL = `tel:+${CONTACT_PHONE_E164}`;

export interface SocialLink {
  key: 'facebook' | 'instagram' | 'youtube' | 'linkedin' | 'x' | 'gmb';
  label: string;
  url: string;
}

export const SOCIAL_LINKS: SocialLink[] = [
  { key: 'facebook', label: 'Facebook', url: '' },
  { key: 'instagram', label: 'Instagram', url: '' },
  { key: 'youtube', label: 'YouTube', url: '' },
  { key: 'linkedin', label: 'LinkedIn', url: '' },
  { key: 'x', label: 'X (Twitter)', url: '' },
  { key: 'gmb', label: 'Google Business Profile', url: '' },
];

/** Only the profiles that have a real URL configured. */
export const activeSocialLinks = () => SOCIAL_LINKS.filter((s) => !!s.url);
