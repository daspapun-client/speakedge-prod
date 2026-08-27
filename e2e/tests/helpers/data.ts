/** Test-data builders and fixtures shared across the happy-path journey. */

/** A minimal valid 1x1 PNG — used for photo / id-proof / video uploads. */
export const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Short unique suffix so re-runs against a persistent DB don't collide. */
export function uid(len = 6): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

/** Seeded credentials created by `python -m app.db.seed`. */
export const SEED = {
  admin: { username: 'admin@speakedge.in', password: 'Admin@12345' },
  examiner: { username: 'examiner@speakedge.in', password: 'Examiner@123' },
} as const;

/**
 * Multipart body for POST /membership/activate. `code` becomes the permanent
 * Student ID, and `password` is what the new student logs in with.
 * Booleans are sent as "true" strings because FastAPI Form(bool) expects that.
 */
export function membershipForm(code: string, password: string) {
  const tag = uid();
  return {
    code,
    full_name: `E2E Student ${tag}`,
    // Age and the Kids/Adult section are derived from the date of birth.
    dob: `${new Date().getFullYear() - 19}-01-01`,
    gender: 'male',
    phone: '9800000001',
    whatsapp: '9800000001',
    address: '12 Test Lane, Salt Lake',
    state: 'West Bengal',
    district: 'Kolkata',
    pin_code: '700001',
    password,
    email: `e2e_${tag}@example.com`,
    cefr_level: 'B1',
    education_level: 'Graduate',
    about_me: 'Automated end-to-end happy-path test student.',
    consent_community_rules: 'true',
    consent_terms: 'true',
    consent_safety_policy: 'true',
    consent_non_refund: 'true',
    consent_process: 'true',
    id_proof_type: 'Masked Aadhaar',
    photo: { name: 'photo.png', mimeType: 'image/png', buffer: PNG_1x1 },
    id_proof: { name: 'id_proof.png', mimeType: 'image/png', buffer: PNG_1x1 },
    education_proof: { name: 'education.png', mimeType: 'image/png', buffer: PNG_1x1 },
  };
}

/** ISO timestamp `days` in the future (e.g. upcoming exam schedules). */
export function futureISO(days = 7): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Beanie documents serialize their id as `id` (sometimes `_id`); accept both. */
export function idOf(obj: any): string {
  const id = obj?.id ?? obj?._id;
  if (!id) throw new Error(`No id on object: ${JSON.stringify(obj)}`);
  return String(id);
}

