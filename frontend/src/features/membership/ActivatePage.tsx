import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Not Sure'];

// Mirrors ID_PROOF_TYPES in backend/app/modules/membership/router.py — the
// server rejects anything outside this list, so keep the two in sync.
export const ID_PROOF_TYPES = [
  'Aadhaar Card',
  'PAN Card',
  'Passport',
  'Voter ID',
  'Driving Licence',
  'Ration Card',
  'School / College ID Card',
  'Birth Certificate',
];

// The five Form(bool) consents the backend still requires. The learner now
// accepts them with one combined checkbox (see TermsAndConsent below), so all
// five are submitted together.
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

export function ActivatePage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string>();
  const [agreed, setAgreed] = useState(false);
  // Which course the entered code enrols into. Kids and Adults are separate
  // courses decided by admin when the code is issued — this is read-only
  // confirmation for the learner, not a choice.
  const [course, setCourse] = useState<string | null>(null);

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
            onBlur={(e) => lookUpCourse(e.target.value)}
          />
          {course && (
            <p className="mt-2 text-sm text-slate-600">
              This code enrols you in the{' '}
              <span className="badge bg-brand/10 text-brand">
                {course === 'kids' ? 'Kids' : 'Adults'} course
              </span>
              . The course is set when the code is issued and cannot be changed here.
            </p>
          )}
        </div>
        <div>
          <label className="label">Full name *</label>
          <input name="full_name" className="input" required />
        </div>
        <div>
          <label className="label">Create Password *</label>
          <input name="password" type="password" className="input" minLength={6} required />
          <p className="mt-1 text-xs text-slate-500">Minimum 6 characters</p>
        </div>
        <div>
          <label className="label">Age *</label>
          <input name="age" type="number" min={1} max={120} className="input" required />
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
        <div>
          <label className="label">Date of birth</label>
          <input name="dob" type="date" className="input" />
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
          <label className="label">Self-declared CEFR level</label>
          <select name="cefr_level" className="input" defaultValue="">
            <option value="">Prefer not to say</option>
            {CEFR_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">About me (within 100 words)</label>
          <textarea name="about_me" className="input" rows={2} />
        </div>
        <div>
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
          <label className="label">ID proof type *</label>
          <select name="id_proof_type" className="input" required defaultValue="">
            <option value="" disabled>Select a document…</option>
            {ID_PROOF_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">ID proof number</label>
          <input name="id_proof_number" className="input" placeholder="As printed on the document" />
        </div>
        <div className="md:col-span-2">
          <label className="label">Upload ID proof * (≤ 1 MB, JPG/PNG/PDF)</label>
          <input name="id_proof" type="file" accept="image/*,application/pdf" className="input" required />
        </div>

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
              restriction or suspension of community access.{' '}
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
              applicable membership features will be provided after successful verification.
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
        <button className="btn-primary md:col-span-2" disabled={loading || !agreed}>
          {loading ? 'Submitting…' : 'Activate Membership'}
        </button>
      </form>
    </div>
  );
}
