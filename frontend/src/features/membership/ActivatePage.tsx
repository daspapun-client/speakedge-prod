import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth';

/** Every allowlist and age rule the registration form needs, served by
 *  GET /membership/form-options. Nothing here is duplicated in the frontend —
 *  the backend is the single source of truth for what it will accept. */
export interface ActivationOptions {
  id_proof_types: string[];
  academic_levels: string[];
  guardian_relationships: string[];
  cefr_levels: string[];
  min_age: number;
  kids_max_age: number;
  minor_age: number;
}

const FALLBACK_OPTIONS: ActivationOptions = {
  id_proof_types: [],
  academic_levels: [],
  guardian_relationships: [],
  cefr_levels: [],
  min_age: 8,
  kids_max_age: 15,
  minor_age: 18,
};

export function useActivationOptions() {
  const { data } = useQuery({
    queryKey: ['activation-form-options'],
    queryFn: async () =>
      (await axios.get('/api/v1/membership/form-options')).data.data as ActivationOptions,
    staleTime: 5 * 60_000,
  });
  return data ?? FALLBACK_OPTIONS;
}

/** Completed years as of today. Mirrors `age_from_dob` in the backend, which is
 *  the one that actually decides — this only drives what the form shows. */
export function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const born = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

/** Kids / Adult Section allocation + the under-18 flag, all derived from age. */
export function sectionFor(age: number | null, o: ActivationOptions) {
  if (age === null) return null;
  if (age < o.min_age) return { eligible: false, section: null, minor: true } as const;
  return {
    eligible: true,
    section: age <= o.kids_max_age ? 'Kids Section' : 'Adult Section',
    minor: age < o.minor_age,
  } as const;
}

// The five Form(bool) consents the backend still requires. The learner accepts
// them with one combined checkbox (see the Terms & Consent section below), so
// all five are submitted together. Guardian consent is separate and only
// applies to under-18s.
export const ACTIVATION_CONSENTS = [
  'consent_terms',
  'consent_community_rules',
  'consent_safety_policy',
  'consent_non_refund',
  'consent_process',
] as const;

/** Policy links rendered inside the consent explanations. */
function PolicyLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline underline-offset-2 hover:text-brand-light">
      {children}
    </Link>
  );
}

function ConsentBlock({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-bold text-slate-800">{heading}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{children}</p>
    </section>
  );
}

/** Shared note under the two verification uploads (requirement: these documents
 *  are never visible to other SpeakEdge members). */
export const PRIVATE_DOC_NOTE =
  'Kept private and used only for verification — never visible to other SpeakEdge members.';

/**
 * Parent / legal guardian block. Rendered for every learner under 18, including
 * 16–17 year-olds who sit in the Adult Section.
 */
export function GuardianFields({
  options,
  consent,
  onConsentChange,
}: {
  options: ActivationOptions;
  consent: boolean;
  onConsentChange: (v: boolean) => void;
}) {
  return (
    <fieldset className="md:col-span-2 rounded-xl border border-amber-300 bg-amber-50/70 p-4">
      <legend className="px-1 text-sm font-bold text-amber-900">
        Parent / Legal Guardian details (required — learner is under {options.minor_age})
      </legend>
      <p className="text-sm text-amber-900">
        Members under {options.minor_age} are subject to additional parental-consent and
        community-safety requirements.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Parent/Legal Guardian Full Name *</label>
          <input name="guardian_name" className="input" required />
        </div>
        <div>
          <label className="label">Relationship to Learner *</label>
          <select name="guardian_relationship" className="input" required defaultValue="">
            <option value="" disabled>Select…</option>
            {options.guardian_relationships.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Parent/Legal Guardian Mobile Number *</label>
          <input name="guardian_phone" className="input" required />
        </div>
        <div>
          <label className="label">Parent/Legal Guardian Email (Optional)</label>
          <input name="guardian_email" type="email" className="input" />
        </div>
      </div>
      <label className="mt-3 flex items-start gap-3 rounded-lg border border-amber-300 bg-white p-3 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          checked={consent}
          onChange={(e) => onConsentChange(e.target.checked)}
        />
        <span>
          I am the parent/legal guardian of this learner and I consent to their registration
          with SpeakEdge, to the verification of the information and documents submitted, to the
          processing of their personal data as described in the{' '}
          <PolicyLink to="/privacy">Privacy Policy</PolicyLink>, and to their participation in the
          applicable SpeakEdge services under the{' '}
          <PolicyLink to="/terms">Terms &amp; Conditions</PolicyLink>,{' '}
          <PolicyLink to="/community-rules">Speaking Community Rules</PolicyLink> and{' '}
          <PolicyLink to="/safety-policy">Community Safety Policy</PolicyLink>. *
        </span>
      </label>
    </fieldset>
  );
}

/** Live read-out of what the entered date of birth means: age, eligibility and
 *  the section the learner is automatically allocated to. */
export function SectionNotice({ age, options }: { age: number | null; options: ActivationOptions }) {
  const s = sectionFor(age, options);
  if (age === null || !s) return null;
  if (!s.eligible) {
    return (
      <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">
        Age {age} — learners under {options.min_age} are not eligible for membership activation.
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-slate-600">
      Age {age} · automatically allocated to the{' '}
      <span className="badge bg-brand/10 text-brand">{s.section}</span>
      {s.minor && ' · parental consent required'}
    </p>
  );
}

export function ActivatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // The order-confirmation screen links here with the code already in hand.
  const presetCode = params.get('code') ?? '';
  const options = useActivationOptions();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string>();
  const [agreed, setAgreed] = useState(false);
  const [guardianConsent, setGuardianConsent] = useState(false);
  // Age is never typed in — it is derived from the date of birth, and it is
  // what decides eligibility and the Kids/Adult Section.
  const [age, setAge] = useState<number | null>(null);
  // Which course the entered code was sold for. Shown for confirmation only;
  // the section the learner actually lands in comes from their age.
  const [course, setCourse] = useState<string | null>(null);

  const derived = sectionFor(age, options);
  const isMinor = derived?.eligible === true && derived.minor;
  const blocked = derived?.eligible === false;

  useEffect(() => {
    if (presetCode) lookUpCourse(presetCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetCode]);

  async function lookUpCourse(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return setCourse(null);
    try {
      const res = await axios.get('/api/v1/membership/form-options', { params: { code: trimmed } });
      setCourse(res.data.data.audience ?? null);
    } catch {
      setCourse(null);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const form = new FormData(e.currentTarget);
    // One learner-facing checkbox stands in for all five backend consents.
    for (const name of ACTIVATION_CONSENTS) {
      form.set(name, agreed ? 'true' : 'false');
    }
    form.set('consent_guardian', isMinor && guardianConsent ? 'true' : 'false');
    // Backend rejects an empty cefr_level (must be A1–C2 / "Not Sure" / absent).
    if (!form.get('cefr_level')) form.delete('cefr_level');
    try {
      const res = await axios.post('/api/v1/membership/activate', form);
      const sid = res.data.data.student_id as string;
      navigate(`/status/${sid}`);
    } catch (err) {
      const ax = err as { response?: { data?: { error?: { message?: string }; message?: string } } };
      setError(ax.response?.data?.error?.message || ax.response?.data?.message || 'Activation failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-extrabold">Membership Activation</h1>
      <p className="mt-2 text-slate-600">
        Enter the Activation Code from your book. It becomes your permanent Student ID.
      </p>
      <form onSubmit={onSubmit} className="card mt-6 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="label">Activation Code *</label>
          <input
            name="code"
            className="input"
            placeholder="SPK-26-XXXXXX"
            required
            defaultValue={presetCode}
            onBlur={(e) => lookUpCourse(e.target.value)}
          />
          {course && (
            <p className="mt-2 text-sm text-slate-600">
              This code was issued for the{' '}
              <span className="badge bg-brand/10 text-brand">
                {course === 'kids' ? 'Kids' : 'Adults'} course
              </span>
              . Your section is allocated automatically from your date of birth.
            </p>
          )}
        </div>
        <div>
          <label className="label">Full name *</label>
          <input name="full_name" className="input" required />
        </div>
        <div>
          <label className="label">Create Password *</label>
          <input name="password" type="password" className="input" minLength={MIN_PASSWORD_LENGTH} required />
          <p className="mt-1 text-xs text-slate-500">Minimum {MIN_PASSWORD_LENGTH} characters</p>
        </div>
        <div className="md:col-span-2">
          <label className="label">Date of Birth *</label>
          <input
            name="dob"
            type="date"
            className="input"
            required
            onChange={(e) => setAge(ageFromDob(e.target.value))}
          />
          <SectionNotice age={age} options={options} />
        </div>
        <div>
          <label className="label">Gender *</label>
          <select name="gender" className="input" required defaultValue="">
            <option value="" disabled>Select…</option>
            <option>Male</option>
            <option>Female</option>
            <option>Other</option>
          </select>
        </div>
        <div>
          <label className="label">Mobile number *</label>
          <input name="phone" className="input" required />
        </div>
        <div>
          <label className="label">WhatsApp Number (Optional)</label>
          <input name="whatsapp" className="input" />
        </div>
        <div>
          <label className="label">Email</label>
          <input name="email" type="email" className="input" />
        </div>
        <div className="md:col-span-2">
          <label className="label">Full address *</label>
          <textarea name="address" className="input" rows={2} required />
        </div>
        <div>
          <label className="label">State *</label>
          <input name="state" className="input" required />
        </div>
        <div>
          <label className="label">District *</label>
          <input name="district" className="input" required />
        </div>
        <div>
          <label className="label">PIN code *</label>
          <input name="pin_code" className="input" required />
        </div>
        <div>
          <label className="label">Self-declared CEFR Speaking Level</label>
          <select name="cefr_level" className="input" defaultValue="">
            <option value="">Prefer not to say</option>
            {options.cefr_levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Academic / Educational Background *</label>
          <select name="education_level" className="input" required defaultValue="">
            <option value="" disabled>Select…</option>
            {options.academic_levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">About Me (Optional – within 100 words)</label>
          <textarea name="about_me" className="input" rows={2} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Profile photo * (≤ 500 KB, auto-compressed)</label>
          <input
            name="photo"
            type="file"
            accept="image/*"
            className="input"
            required
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPhotoPreview(URL.createObjectURL(f));
            }}
          />
          {photoPreview && <img src={photoPreview} alt="preview" className="mt-2 h-20 w-20 rounded object-cover" />}
        </div>
        <div>
          <label className="label">Identity Proof * </label>
          <select name="id_proof_type" className="input" required defaultValue="">
            <option value="" disabled>Select a document…</option>
            {options.id_proof_types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Required for identity and membership verification.
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="label">Upload Identity Proof * (≤ 1 MB, JPG/PNG/PDF)</label>
          <input name="id_proof" type="file" accept="image/*,application/pdf" className="input" required />
          <p className="mt-1 text-xs text-slate-500">{PRIVATE_DOC_NOTE}</p>
        </div>
        <div className="md:col-span-2">
          <label className="label">Academic / Educational Proof * (≤ 1 MB, JPG/PNG/PDF)</label>
          <input name="education_proof" type="file" accept="image/*,application/pdf" className="input" required />
          <p className="mt-1 text-xs text-slate-500">
            Upload an accepted school, college, academic or educational document verifying your
            educational background. {PRIVATE_DOC_NOTE}
          </p>
        </div>

        {isMinor && (
          <GuardianFields
            options={options}
            consent={guardianConsent}
            onConsentChange={setGuardianConsent}
          />
        )}

        <section className="md:col-span-2 border-t border-slate-200 pt-5">
          <h2 className="text-lg font-bold text-slate-900">Membership Activation – Terms &amp; Consent</h2>
          <p className="mt-1 text-sm text-slate-600">
            Before activating your SpeakEdge membership, please read and understand the following:
          </p>

          <div className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <ConsentBlock heading="Terms &amp; Conditions and Privacy Policy">
              By activating your membership, you agree to the SpeakEdge{' '}
              <PolicyLink to="/terms">Terms &amp; Conditions</PolicyLink> and acknowledge that the
              personal information provided during registration will be collected and used in
              accordance with our <PolicyLink to="/privacy">Privacy Policy</PolicyLink>.
            </ConsentBlock>

            <ConsentBlock heading="Speaking Community Rules">
              SpeakEdge provides opportunities to interact with other learners through individual
              speaking partners, conversation teams and other community activities according to the
              benefits available under your membership. Members must communicate respectfully, follow
              the Speaking Community Rules and maintain appropriate behaviour while interacting with
              other members.{' '}
              <PolicyLink to="/community-rules">View Speaking Community Rules</PolicyLink>
            </ConsentBlock>

            <ConsentBlock heading="Community Safety Policy">
              Members must follow SpeakEdge&apos;s Community Safety Policy while participating in
              speaking activities and interacting with other learners. Misuse of the platform,
              inappropriate behaviour or violation of community safety requirements may result in
              restriction or suspension of community access. Members under {options.minor_age} are
              subject to additional parental-consent and community-safety requirements.{' '}
              <PolicyLink to="/safety-policy">View Community Safety Policy</PolicyLink>
            </ConsentBlock>

            <ConsentBlock heading="Membership Fee and Refund Policy">
              Membership, admission and subscription fees paid for SpeakEdge are subject to the
              applicable cancellation and refund terms.{' '}
              <PolicyLink to="/refund-policy">View Cancellation &amp; Refund Policy</PolicyLink>
            </ConsentBlock>

            <ConsentBlock heading="Membership Verification">
              Membership activation is subject to verification of the information and documents
              submitted by the learner. The verification process may take up to 72 hours. Access to
              applicable membership features will be provided after successful verification. Your
              Identity Proof and Academic / Educational Proof are used for verification only and are
              never visible to other SpeakEdge members.
            </ConsentBlock>
          </div>

          <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I have read and agree to the Terms &amp; Conditions, Privacy Policy, Speaking Community
              Rules, Community Safety Policy, applicable Cancellation &amp; Refund Policy, and the
              membership verification process described above.
            </span>
          </label>
        </section>

        {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
        <button
          className="btn-primary md:col-span-2"
          disabled={loading || !agreed || blocked || (isMinor && !guardianConsent)}
        >
          {loading ? 'Submitting…' : 'Activate Membership'}
        </button>
      </form>
    </div>
  );
}
