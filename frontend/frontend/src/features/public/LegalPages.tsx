/**
 * Static footer pages — Privacy Policy, Terms & Conditions, FAQ, Speaking
 * Community Rules, Community Safety Policy and Cancellation & Refund Policy.
 * The Privacy Policy, Terms, Refund Policy, Safety Policy and Community Rules
 * carry the company-supplied legal wording (August 2026 revision) and should
 * only be edited from an updated source document. Bump `settings.TERMS_VERSION`
 * whenever the Terms or Refund Policy change.
 */
import { Shield } from 'lucide-react';
import { CONTACT_PHONE, SUPPORT_EMAIL, WHATSAPP_URL } from '@/lib/site';

function sectionIdFromHeading(heading: string): string {
  return heading
    .replace(/^\d+\.\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function Doc({
  title,
  updated,
  toc,
  badge = 'Legal document',
  children,
}: {
  title: string;
  updated?: string;
  toc?: string[];
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="max-w-4xl">
      <header className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-white to-brand/[0.06] px-6 py-8 shadow-sm sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/[0.07]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-6 left-1/3 h-24 w-24 rounded-full bg-brand-gold/[0.08]"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-brand/15 bg-brand/[0.08] px-3 py-1 text-xs font-semibold text-brand">
            <Shield size={13} strokeWidth={2.25} />
            {badge}
          </div>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {title}
          </h1>
          {updated && (
            <p className="mt-2 text-sm text-slate-500">
              Last updated{' '}
              <time dateTime={updated} className="font-medium text-slate-700">
                {updated}
              </time>
            </p>
          )}
          <p className="mt-1 text-xs font-medium text-slate-400">
            SpeakEdge — A Product of Sujyoti EdTech Pvt. Ltd.
          </p>
        </div>
      </header>

      {toc && toc.length > 0 && (
        <nav
          aria-label="Table of contents"
          className="mt-6 rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">On this page</p>
          <ol className="mt-3 grid gap-1 sm:grid-cols-2">
            {toc.map((label, i) => {
              const id = sectionIdFromHeading(label);
              return (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-600 transition hover:bg-brand/[0.05] hover:text-brand"
                  >
                    <span className="mt-px shrink-0 w-5 font-semibold tabular-nums text-slate-400 group-hover:text-brand">
                      {i + 1}.
                    </span>
                    <span>{label}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="mt-6 space-y-4">{children}</div>
    </article>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-brand/15 bg-gradient-to-br from-brand/[0.04] to-brand/[0.01] px-5 py-4 text-[0.9375rem] leading-relaxed text-slate-700 shadow-sm [&_a]:font-medium [&_a]:text-brand [&_a]:hover:underline">
      {children}
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  const id = sectionIdFromHeading(heading);
  return (
    <section
      id={id}
      className="scroll-mt-28 rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 className="flex items-start gap-3 text-lg font-bold tracking-tight text-slate-900">
        <span aria-hidden className="mt-1.5 h-5 w-1 shrink-0 rounded-full bg-gradient-to-b from-brand to-brand-light" />
        {heading}
      </h2>
      <div className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-slate-600 [&_a]:font-medium [&_a]:text-brand [&_a]:hover:underline [&_p.font-semibold]:mt-4 [&_p.font-semibold:first-child]:mt-0 [&_p.font-semibold]:text-xs [&_p.font-semibold]:font-bold [&_p.font-semibold]:uppercase [&_p.font-semibold]:tracking-wide [&_p.font-semibold]:text-slate-800">
        {children}
      </div>
    </section>
  );
}

function GroupHeading({ children }: { children: string }) {
  return (
    <h2 className="rounded-lg border border-slate-200/80 bg-slate-50 px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
      {children}
    </h2>
  );
}

function ContactBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-brand/10 bg-gradient-to-br from-brand/[0.04] to-transparent px-4 py-3.5 text-sm leading-relaxed text-slate-700">
      {children}
    </div>
  );
}

const LAST_UPDATED = 'August 2026';

const PRIVACY_TOC = [
  'Information We May Collect',
  'Website, Enquiry and Advertising Information',
  'Meta and Other Advertising Platforms',
  'How We Use Personal Information',
  'Children and Learners Under 18',
  'Third-Party AI Services',
  'Sharing of Personal Information',
  'Community Profile Visibility',
  'Data Security',
  'Data Retention',
  'Your Choices and Requests',
  'Service and Marketing Communications',
  'Third-Party Services and Links',
  'Changes to This Privacy Policy',
  'Privacy Questions, Requests and Grievances',
];

const COMMUNITY_RULES_TOC = [
  'Speak Respectfully',
  'Use the Community for English Practice',
  'Respect Privacy',
  'Speaking Partners and Conversation Teams',
  'Protect Your Account',
  'Younger Learners and Minors',
  'No Unauthorised Commercial or Financial Activity',
  'Blocking and Reporting',
  'If the Rules Are Broken',
  'Follow the Community Safety Policy',
];

export function PrivacyPage() {
  return (
    <Doc title="Privacy Policy" updated={LAST_UPDATED} toc={PRIVACY_TOC}>
      <Lead>
        SpeakEdge is a product of Sujyoti EdTech Pvt. Ltd. This Privacy Policy explains how we
        collect, use, store, share and protect personal information when you visit our website,
        enquire about our services, purchase a product, activate or use a SpeakEdge membership,
        participate in the Speaking Community, or otherwise interact with us. By providing personal
        information to SpeakEdge, you acknowledge that it will be handled in accordance with this
        Privacy Policy and applicable law.
      </Lead>

      <Section heading="1. Information We May Collect">
        <p>Depending on how you interact with SpeakEdge, we may collect:</p>
        <p className="font-semibold text-slate-900">Account and Membership Information</p>
        <Bullets
          items={[
            'full name;',
            'date of birth and age;',
            'gender;',
            'mobile number;',
            'WhatsApp number, where provided;',
            'email address;',
            'residential/contact address, state, district and PIN code;',
            'Student ID, Activation Code and account information; and',
            'membership and subscription details.',
          ]}
        />
        <p className="font-semibold text-slate-900">Verification Information</p>
        <p>For membership verification, we may collect:</p>
        <Bullets
          items={[
            'profile photograph;',
            'accepted Identity Proof;',
            'academic/educational background;',
            'Academic/Educational Proof; and',
            'other information reasonably required to verify membership eligibility or information submitted during registration.',
          ]}
        />
        <p>
          Verification documents are used for authorised verification, administration, platform
          integrity and safety purposes and are not displayed to other SpeakEdge members.
        </p>
        <p className="font-semibold text-slate-900">Learning and Assessment Information</p>
        <p>We may collect information relating to:</p>
        <Bullets
          items={[
            'self-declared CEFR Speaking Level;',
            'learning preferences and profile information;',
            'Teacher-led Class participation and attendance;',
            'Speaking Community participation;',
            'CEFR-referenced Speaking Level Assessment results;',
            'SpeakEdge Speaking Test results;',
            'certificates and assessment records; and',
            'other learning activities conducted within or recorded by SpeakEdge.',
          ]}
        />
        <p className="font-semibold text-slate-900">Community Information</p>
        <p>Where you participate in the Speaking Community, we may process information relating to:</p>
        <Bullets
          items={[
            'your member profile;',
            'Individual Speaking Partners;',
            'Conversation Teams;',
            'Community interactions;',
            'connection/friend requests;',
            'blocks and reports; and',
            'safety or conduct matters reported to SpeakEdge.',
          ]}
        />
        <p className="font-semibold text-slate-900">Orders and Payments</p>
        <p>We may collect:</p>
        <Bullets
          items={[
            'product and membership orders;',
            'billing and delivery information;',
            'payment status;',
            'transaction/reference numbers;',
            'invoices;',
            'cancellation/refund information; and',
            'purchase history.',
          ]}
        />
        <p>
          Payment-card, UPI, banking or similar payment credentials may be processed by the
          applicable authorised payment gateway or payment service provider. SpeakEdge does not
          ordinarily store complete card or banking credentials where those details are processed
          directly by the payment provider.
        </p>
      </Section>

      <Section heading="2. Website, Enquiry and Advertising Information">
        <p>
          When you visit our website, submit an enquiry, request a demo, respond to an advertisement
          or otherwise contact SpeakEdge, we may collect information such as your:
        </p>
        <Bullets
          items={[
            'name;',
            'mobile/WhatsApp number;',
            'email address;',
            'age or learner category, where relevant;',
            'course/membership interest;',
            'enquiry details; and',
            'information voluntarily submitted through a contact or lead form.',
          ]}
        />
        <p>
          We may also receive limited technical information associated with website usage, such as
          device/browser information, IP address, pages visited, referral information and cookies or
          similar technologies, where applicable.
        </p>
      </Section>

      <Section heading="3. Meta and Other Advertising Platforms">
        <p>
          SpeakEdge may advertise its products and services through third-party advertising
          platforms, including Meta platforms such as Facebook and Instagram, and other digital
          advertising services. Where you submit information through a lead form or advertisement on
          a third-party platform, information you provide may be received by both that platform and
          Sujyoti EdTech Pvt. Ltd. The third-party platform processes information according to its
          own privacy terms and policies.
        </p>
        <p>We may use information received through advertising campaigns to:</p>
        <Bullets
          items={[
            'respond to your enquiry;',
            'contact you regarding the product, course, demo or membership you expressed interest in;',
            'provide relevant information about SpeakEdge services;',
            'measure advertising and campaign performance; and',
            'improve our marketing and customer communication.',
          ]}
        />
        <p>
          Where cookies, pixels or similar advertising technologies are used on our website, their
          use will be subject to applicable consent and privacy requirements.
        </p>
      </Section>

      <Section heading="4. How We Use Personal Information">
        <p>We may use personal information to:</p>
        <Bullets
          items={[
            'create and manage SpeakEdge accounts;',
            'verify identity and membership information;',
            'verify academic/educational background;',
            'issue and manage Student IDs;',
            'determine the appropriate SpeakEdge learning section;',
            'provide applicable membership benefits;',
            'provide Teacher-led Classes and Speaking Community services;',
            'administer assessments and certificates;',
            'personalise applicable learning content and Prompt Library resources;',
            'process orders, payments, deliveries, cancellations and refunds;',
            'provide Student Relation Support and customer service;',
            'communicate service, payment, class, assessment, Community-access and membership-related information;',
            'investigate Community reports, fraud, misuse or safety concerns;',
            'maintain platform security;',
            'comply with applicable legal and regulatory requirements; and',
            'improve SpeakEdge products and services.',
          ]}
        />
      </Section>

      <Section heading="5. Children and Learners Under 18">
        <p>For SpeakEdge learning purposes:</p>
        <Bullets items={['Kids Section: 8–15 years', 'Adult Section: 16 years and above']} />
        <p>
          These are SpeakEdge learning categories only. A learner below 18 years of age remains a
          minor for applicable privacy, consent and safety requirements. Where required, SpeakEdge
          will obtain appropriate parent/legal guardian information and consent before processing a
          minor&apos;s personal information or enabling applicable services. Parents/legal guardians
          should review this Privacy Policy, the{' '}
          <a href="/terms" className="font-medium text-brand hover:underline">
            Terms &amp; Conditions
          </a>
          ,{' '}
          <a href="/community-rules" className="font-medium text-brand hover:underline">
            Speaking Community Rules
          </a>{' '}
          and{' '}
          <a href="/safety-policy" className="font-medium text-brand hover:underline">
            Community Safety Policy
          </a>{' '}
          before providing consent. SpeakEdge applies additional safety requirements to the
          participation of minors in Community activities.
        </p>
      </Section>

      <Section heading="6. Third-Party AI Services">
        <p>
          SpeakEdge may provide a Prompt Library or learning instructions that learners can use with
          independent third-party artificial-intelligence services. Third-party AI services such as
          ChatGPT, Gemini, Claude, Copilot or similar services are not operated or controlled by
          Sujyoti EdTech Pvt. Ltd. Where a learner independently enters a SpeakEdge prompt or other
          information into a third-party AI service, the information submitted to that service is
          processed according to the third party&apos;s own terms and privacy practices.
        </p>
        <p>
          SpeakEdge does not automatically receive or store a learner&apos;s conversations with an
          independent third-party AI service merely because the learner uses a prompt obtained from
          SpeakEdge. Learners should avoid submitting unnecessary personal or confidential
          information to third-party AI services.
        </p>
      </Section>

      <Section heading="7. Sharing of Personal Information">
        <p>We do not sell your personal information.</p>
        <p>
          Personal information may be shared, where reasonably necessary, with authorised persons or
          service providers involved in delivering or supporting SpeakEdge services, which may
          include:
        </p>
        <Bullets
          items={[
            'authorised teachers and examiners;',
            'authorised administrative/support personnel;',
            'authorised partners where necessary for the applicable service;',
            'payment service providers;',
            'hosting, cloud and technology service providers;',
            'communication, email or messaging providers;',
            'delivery/logistics providers;',
            'professional advisers; and',
            'government, regulatory, judicial or law-enforcement authorities where disclosure is required or permitted by law.',
          ]}
        />
        <p>Only information reasonably necessary for the relevant purpose should be shared.</p>
      </Section>

      <Section heading="8. Community Profile Visibility">
        <p>
          Certain profile information may be visible to other eligible SpeakEdge members where
          necessary for Speaking Community participation. This may include information such as the
          member&apos;s:
        </p>
        <Bullets
          items={[
            'display name;',
            'profile photograph;',
            'relevant speaking/community profile information; and',
            'other information specifically designated for Community visibility.',
          ]}
        />
        <p>
          Identity Proof, Academic/Educational Proof, residential address, payment information and
          other verification documents are not displayed to other Community members.
        </p>
      </Section>

      <Section heading="9. Data Security">
        <p>
          Sujyoti EdTech Pvt. Ltd. takes reasonable administrative, technical and organisational
          measures designed to protect personal information against unauthorised access, disclosure,
          alteration, loss or misuse. Access to verification documents and other sensitive account
          information should be limited to authorised persons who require such access for legitimate
          business, verification, safety or legal purposes. No online system can guarantee absolute
          security, but reasonable safeguards will be maintained in accordance with applicable
          requirements.
        </p>
      </Section>

      <Section heading="10. Data Retention">
        <p>
          Personal information will be retained for as long as reasonably necessary for the purposes
          for which it was collected, including membership administration, verification, learning
          records, safety, dispute resolution and legal, accounting or regulatory requirements.
          Different categories of information may therefore have different retention periods. Where
          information is no longer reasonably required and there is no legal or legitimate
          requirement to retain it, it may be deleted, anonymised or otherwise securely disposed of
          in accordance with applicable procedures.
        </p>
      </Section>

      <Section heading="11. Your Choices and Requests">
        <p>
          Subject to applicable law and the nature of the information concerned, you may contact
          SpeakEdge to request:
        </p>
        <Bullets
          items={[
            'access to applicable personal information;',
            'correction or updating of inaccurate information;',
            'account closure;',
            'withdrawal of consent where processing is based on consent; or',
            'deletion/erasure of applicable personal information where legally available.',
          ]}
        />
        <p>
          Withdrawal of consent may affect services that cannot reasonably be provided without
          processing the relevant information. Certain information may need to be retained where
          required for legal, financial, security, fraud-prevention or dispute-resolution purposes.
        </p>
      </Section>

      <Section heading="12. Service and Marketing Communications">
        <p>
          SpeakEdge may send communications necessary for providing the service, including
          information concerning:
        </p>
        <Bullets
          items={[
            'membership verification;',
            'Teacher-led Classes;',
            'assessments;',
            'payments;',
            'Community-access expiry;',
            'account/security matters; and',
            'other membership-related services.',
          ]}
        />
        <p>
          Where promotional or marketing communications are sent, users will be provided with
          applicable choices to manage such communications as required by law.
        </p>
      </Section>

      <Section heading="13. Third-Party Services and Links">
        <p>
          The SpeakEdge website or platform may contain links to or integrate with third-party
          websites, payment gateways, AI services, marketplaces, communication services or other
          platforms. These third parties operate independently and may have their own privacy
          policies and terms. SpeakEdge is not responsible for the independent privacy practices of
          third-party services.
        </p>
      </Section>

      <Section heading="14. Changes to This Privacy Policy">
        <p>
          This Privacy Policy may be updated from time to time to reflect changes in SpeakEdge
          services, technology, business practices or applicable legal requirements. Where
          appropriate, material changes may be communicated through the website, platform or other
          available communication channels.
        </p>
      </Section>

      <Section heading="15. Privacy Questions, Requests and Grievances">
        <p>
          For privacy-related questions, correction requests, consent withdrawal, account-related
          privacy requests or grievances, contact:
        </p>
        <ContactBox>
          <p className="font-semibold text-slate-900">Sujyoti EdTech Pvt. Ltd.</p>
          <p className="mt-2">
            Email: <SupportEmail />
          </p>
          <p className="mt-1">
            WhatsApp / Mobile: <SupportWhatsApp />
          </p>
        </ContactBox>
        <p>Requests may be subject to reasonable identity verification before action is taken.</p>
      </Section>
    </Doc>
  );
}

/** Membership validity table — quoted verbatim in Terms sections 1, 4 and 5. */
const VALIDITY: string[] = [
  'Tribe — 1 Year',
  'Basic — 1 Year',
  'Silver / Silver Pro — 2 Years',
  'Gold / Gold Pro — 3 Years',
  'Diamond / Diamond Pro — 5 Years',
];

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brand/70"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}


function SupportEmail() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-brand hover:underline">
      {SUPPORT_EMAIL}
    </a>
  );
}

function SupportWhatsApp() {
  return (
    <a href={WHATSAPP_URL} className="font-medium text-brand hover:underline">
      {CONTACT_PHONE}
    </a>
  );
}

export function TermsPage() {
  return (
    <Doc title="Terms & Conditions" updated={LAST_UPDATED}>
      <p>
        These Terms &amp; Conditions (&ldquo;Terms&rdquo;) govern the purchase, enrolment, activation
        and use of SpeakEdge memberships, the SpeakEdge Book, the SpeakEdge platform, Speaking
        Community, Teacher-led Classes, assessments, certification and related products and services.
        SpeakEdge is a product of Sujyoti EdTech Pvt. Ltd. (&ldquo;Sujyoti EdTech&rdquo;,
        &ldquo;SpeakEdge&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo; or &ldquo;our&rdquo;). By
        purchasing, enrolling in, activating or using a SpeakEdge Membership, SpeakEdge Book or
        SpeakEdge service, you acknowledge that you have read, understood and agreed to these Terms.
      </p>

      <Section heading="1. SpeakEdge Membership">
        <p>SpeakEdge Membership is personal and non-transferable.</p>
        <p>SpeakEdge Membership is not a lifetime membership.</p>
        <p>
          Each membership has a defined validity period and specified benefits. SpeakEdge membership
          plans may include Tribe, Basic, Silver, Gold, Diamond and their respective Pro Memberships,
          as offered from time to time. The applicable validity periods are:
        </p>
        <Bullets items={VALIDITY} />
        <p>
          The benefits, fees, usage limits and validity applicable to each membership will be
          displayed on the Membership Plans page before purchase.
        </p>
        <p>
          Membership, Student ID, Activation Code, Verification Code, account credentials and
          membership benefits must not be sold, transferred, shared or used by another person.
        </p>
      </Section>

      <Section heading="2. SpeakEdge Book and Tribe Membership">
        <p>
          Every eligible SpeakEdge Book provides access to SpeakEdge Tribe Membership for 1 year,
          subject to successful verification and activation. Accordingly, a learner purchasing an
          eligible SpeakEdge Book does not need to separately purchase Tribe Membership.
        </p>
        <p>
          Only the SpeakEdge Book carries a SpeakEdge membership activation benefit. Other books
          available through the SpeakEdge Book Shop under Sujyoti Publications do not include a
          SpeakEdge Activation Code or SpeakEdge Membership unless expressly stated otherwise before
          purchase.
        </p>
      </Section>

      <Section heading="3. Activation Code, Verification Code and Student ID">
        <p>
          An eligible physical SpeakEdge Book may contain a unique Activation Code inside its sealed
          packaging. Depending on the mode of purchase or enrolment, an Activation Code, Verification
          Code, Student ID or other activation credential may instead be issued electronically after
          verification.
        </p>
        <p>
          Each activation credential is personal and intended for one eligible member and may
          ordinarily be activated only once. Activation credentials must not be copied, shared,
          published, transferred, resold or otherwise misused.
        </p>
        <p>
          Sujyoti EdTech may verify the authenticity and eligibility of a purchase before activating
          the associated membership.
        </p>
      </Section>

      <Section heading="4. Membership Benefits and Validity">
        <p>
          Eligible membership benefits remain available throughout the applicable membership validity
          period, subject to the number, type and usage limits included in the selected plan. The
          applicable validity period is:
        </p>
        <Bullets items={VALIDITY} />
        <p>Depending on the selected membership, benefits may include:</p>
        <Bullets
          items={[
            'Speaking Community Access;',
            'Conversation Teams;',
            'Individual Speaking Partners;',
            'AI-guided learning resources;',
            'SpeakEdge Prompt Library;',
            'Student Relation Support;',
            'CEFR-referenced Speaking Level Assessments;',
            'Speaking Tests; and',
            'other benefits expressly included in the membership.',
          ]}
        />
        <p>
          The quantity and availability of particular benefits are determined by the selected
          membership. Teacher-led Classes are treated separately and are dependent upon payment of
          the applicable monthly fee.
        </p>
      </Section>

      <Section heading="5. Speaking Community Access">
        <p>
          Speaking Community Access remains available throughout the applicable membership validity
          period. Accordingly:
        </p>
        <Bullets items={VALIDITY} />
        <p>
          Community facilities may include Individual Speaking Partners, Conversation Teams and other
          SpeakEdge Community features according to the selected membership. Community access remains
          subject to these Terms, the{' '}
          <a href="/community-rules" className="font-medium text-brand hover:underline">
            Speaking Community Rules
          </a>{' '}
          and the{' '}
          <a href="/safety-policy" className="font-medium text-brand hover:underline">
            Community Safety Policy
          </a>
          .
        </p>
        <p>
          When the applicable validity period expires, Community access and other fixed-validity
          benefits will cease unless the learner renews, upgrades or otherwise becomes eligible for
          continued access.
        </p>
      </Section>

      <Section heading="6. Student Relation Support">
        <p>
          Where Student Relation Support is included in a membership, it remains available throughout
          the applicable membership validity period. Student Relation Support is intended to assist
          learners with relevant membership, learning and platform-related matters. It does not
          guarantee any particular academic result, CEFR-referenced level, speaking score or learning
          outcome.
        </p>
      </Section>

      <GroupHeading>Teacher-led Classes</GroupHeading>

      <Section heading="7. Teacher-led Classes">
        <p>
          Teacher-led Classes are available under eligible Silver, Gold, Diamond and respective Pro
          Memberships upon payment of the applicable monthly fee. The number of Teacher-led Classes
          available per week depends on the selected membership.
        </p>
        <p>
          At initial enrolment in a membership containing Teacher-led Classes, the learner must pay:
          Applicable One-Time Admission Fee + First Month&apos;s Monthly Fee.
        </p>
        <p>
          Payment of only the Admission Fee does not activate Teacher-led Classes. The first
          month&apos;s applicable monthly fee must be successfully paid before Teacher-led Classes
          commence.
        </p>
      </Section>

      <Section heading="8. Monthly Teacher-led Class Period">
        <p>
          The monthly Teacher-led Class period begins from the learner&apos;s first scheduled
          Teacher-led Class date, provided the schedule has been arranged or confirmed with the
          learner&apos;s consent. One month means the period beginning on that date and ending one day
          before the corresponding date in the following month. For example:
        </p>
        <Bullets items={['First scheduled class: 25 January', 'Monthly period: 25 January to 24 February']} />
        <p>
          Once the first Teacher-led Class has been scheduled with the learner&apos;s consent, the
          monthly period commences from that scheduled date even if the learner does not attend.
          Absence, non-attendance, late attendance or voluntary failure to participate does not
          postpone commencement of the monthly period or extend its expiry. The monthly period is
          therefore determined by the scheduled first Teacher-led Class date and not the learner&apos;s
          first actual attendance date.
        </p>
      </Section>

      <Section heading="9. Monthly Payments and Suspension of Teacher-led Classes">
        <p>
          To continue Teacher-led Classes after the current monthly period, the learner must pay the
          next applicable monthly fee. SpeakEdge may provide an advance payment reminder showing the
          applicable due date and amount.
        </p>
        <p>If the applicable monthly fee is not paid, Teacher-led Classes will be suspended.</p>
        <p>
          Non-payment of the monthly fee will not cancel or suspend the learner&apos;s other eligible
          membership benefits while the applicable membership validity remains active. Accordingly,
          eligible Community Access, Conversation Teams, Individual Speaking Partners, Student
          Relation Support, CEFR-referenced Speaking Level Assessments and Speaking Tests will remain
          available according to the selected membership and applicable usage limits.
        </p>
      </Section>

      <Section heading="10. Restarting Teacher-led Classes">
        <p>
          A learner who stops Teacher-led Classes may restart them at any time during the applicable
          membership validity period. Restarting is subject to:
        </p>
        <Bullets
          items={[
            'payment of the applicable monthly fee;',
            'availability of an appropriate Teacher-led batch;',
            "the learner's membership entitlement; and",
            'applicable conditions at the time of restarting.',
          ]}
        />
        <p>
          A new monthly period will begin from the newly scheduled first Teacher-led Class date
          arranged or confirmed with the learner&apos;s consent. Restarting Teacher-led Classes does
          not extend the original membership validity period.
        </p>
      </Section>

      <GroupHeading>Assessment &amp; Certification</GroupHeading>

      <Section heading="11. Scope of SpeakEdge Assessments">
        <p>
          SpeakEdge is an English speaking and communication learning platform. SpeakEdge assessments
          and certifications are designed specifically to evaluate a learner&apos;s English speaking
          and oral communication proficiency.
        </p>
        <p>
          Unless expressly stated otherwise, SpeakEdge assessments and certificates do not assess or
          certify Reading, Writing or Listening proficiency. Any CEFR-referenced level shown on a
          SpeakEdge report or certificate therefore represents a CEFR-referenced Speaking Level, not
          an overall four-skill CEFR proficiency level.
        </p>
      </Section>

      <Section heading="12. CEFR-Referenced Speaking Level Assessment">
        <p>
          SpeakEdge conducts its own speaking assessment methodology with reference to relevant
          descriptors of the Common European Framework of Reference for Languages (CEFR). CEFR
          describes language proficiency through six principal levels: A1 · A2 · B1 · B2 · C1 · C2.
        </p>
        <p>
          SpeakEdge is an independent educational platform. SpeakEdge/Sujyoti EdTech Pvt. Ltd. is
          not the Council of Europe and is not representing itself as an official CEFR accreditation
          or certification body.
        </p>
        <p>
          A CEFR-referenced Speaking Level issued by SpeakEdge represents the learner&apos;s speaking
          performance as determined through the SpeakEdge assessment methodology with reference to
          relevant CEFR speaking descriptors. It must not be interpreted as an overall CEFR
          certification covering Reading, Writing, Listening and Speaking or as a certificate issued,
          accredited or endorsed by the Council of Europe.
        </p>
      </Section>

      <Section heading="13. SpeakEdge Speaking Test">
        <p>
          The SpeakEdge Speaking Test is an independent assessment of English speaking proficiency.
          Its assessment approach is informed by the IELTS Speaking assessment framework. Speaking
          performance may be assessed across the following areas:
        </p>
        <Bullets
          items={[
            'Fluency and Coherence',
            'Lexical Resource',
            'Grammatical Range and Accuracy',
            'Pronunciation',
          ]}
        />
        <p>Performance may be reported using a SpeakEdge Speaking Score on a 0–9 scale.</p>
        <p>
          The SpeakEdge Speaking Test is not an IELTS examination, and a SpeakEdge Speaking Score is
          not an official IELTS Band Score. SpeakEdge/Sujyoti EdTech does not represent itself as an
          IELTS test centre, IELTS partner or IELTS certification authority. Any reference to the
          IELTS Speaking framework is solely for explaining the framework informing SpeakEdge&apos;s
          independent speaking assessment methodology.
        </p>
      </Section>

      <Section heading="14. Assessment Validity and Test Entitlements">
        <p>
          The number of CEFR-referenced Speaking Level Assessments and Speaking Tests available
          depends on the selected membership. Included assessments may be used at any eligible time
          during the applicable membership validity period, subject to:
        </p>
        <Bullets
          items={[
            'the number included in the membership;',
            'available examination dates and slots;',
            'booking requirements;',
            'applicable assessment rules; and',
            "the learner's remaining entitlement.",
          ]}
        />
        <p>
          Unused assessment entitlements expire at the end of the applicable membership validity
          period. Unused assessments are personal, non-transferable, non-refundable and cannot be
          converted into cash.
        </p>
      </Section>

      <Section heading="15. Certificates and Assessment Reports">
        <p>
          SpeakEdge may issue an assessment report and/or certificate following completion of an
          eligible assessment. Depending on the assessment, a document may display:
        </p>
        <Bullets
          items={[
            'SpeakEdge Speaking Score: X.X/9; and/or',
            'CEFR-Referenced Speaking Level: A1 / A2 / B1 / B2 / C1 / C2.',
          ]}
        />
        <p>
          Such certificates and reports represent the learner&apos;s demonstrated speaking performance
          at the time of the SpeakEdge assessment. SpeakEdge certificates are independently issued by
          Sujyoti EdTech Pvt. Ltd. through SpeakEdge and are not certificates issued, accredited or
          endorsed by the Council of Europe, IELTS or another independent examination/accreditation
          organisation unless expressly stated otherwise.
        </p>
        <p>
          SpeakEdge does not guarantee acceptance of its certificates or reports by any university,
          employer, government authority, immigration authority, examination organisation or other
          third party. SpeakEdge does not guarantee that purchasing or completing a membership will
          result in any particular CEFR-referenced Speaking Level or SpeakEdge Speaking Score.
        </p>
      </Section>

      <GroupHeading>Fees, Payments &amp; Refunds</GroupHeading>

      <Section heading="16. Fees and Payments">
        <p>
          All applicable Membership Fees, Admission Fees, monthly fees, book prices, delivery charges,
          taxes and other compulsory charges will be disclosed before payment. Depending upon the
          membership, a learner may pay:
        </p>
        <Bullets
          items={[
            'a One-Time Membership Fee with no monthly fee; or',
            'a One-Time Admission Fee plus an applicable monthly fee for Teacher-led Classes.',
          ]}
        />
        <p>
          Prices and prospective service charges may be revised from time to time. The applicable
          amount will be disclosed before the relevant payment.
        </p>
      </Section>

      <Section heading="17. Non-Refundable Membership and Service Fees">
        <p>
          Subject to applicable law, Membership Fees, Admission Fees, monthly Teacher-led Class fees
          and other fees paid towards an activated or commenced SpeakEdge membership/service are
          non-refundable. No refund will ordinarily be provided because of:
        </p>
        <Bullets
          items={[
            'change of mind;',
            'voluntary discontinuation;',
            'non-use or partial use of membership benefits;',
            'non-attendance at Teacher-led Classes;',
            'voluntary discontinuation of Teacher-led Classes;',
            'failure to use Community facilities;',
            'failure to use included assessments;',
            'failure to use Student Relation Support; or',
            'expiry of unused entitlements.',
          ]}
        />
        <p>
          Discontinuing Teacher-led Classes after a monthly period has commenced does not create a
          refund entitlement for that monthly period.
        </p>
        <p>
          Nothing in these Terms excludes or restricts statutory consumer rights or remedies that
          cannot lawfully be excluded under applicable Indian law.
        </p>
      </Section>

      <Section heading="18. Membership Upgrades">
        <p>
          Learners may upgrade to an eligible higher SpeakEdge Membership. Where applicable, the
          eligible Membership Fee or Admission Fee previously paid will be adjusted against the
          Admission Fee of the upgraded membership according to the upgrade policy applicable at that
          time. For Tribe and Basic, the applicable previous Membership/Admission Fee may also be
          considered for adjustment where eligible.
        </p>
        <p>
          Monthly Teacher-led Class fees are not Admission Fees and are not adjustable against an
          upgraded Admission Fee unless expressly stated otherwise.
        </p>
      </Section>

      <GroupHeading>Book Purchase, Delivery &amp; Returns</GroupHeading>

      <Section heading="19. Physical Book Delivery">
        <p>
          Physical books purchased directly through the SpeakEdge/Sujyoti Publications platform are
          currently delivered within India only. Physical book delivery outside India is currently
          unavailable.
        </p>
        <p>
          For delivery through Speed Post within India, ₹100 per order will be charged unless a
          different delivery charge or promotional arrangement is expressly displayed before
          checkout. The book price, delivery charge and total payable amount will be displayed before
          payment.
        </p>
      </Section>

      <Section heading="20. Online Order Cancellation and Dispatch">
        <p>
          A customer purchasing a physical book directly through SpeakEdge/Sujyoti Publications may
          request cancellation before dispatch. Once the book has been handed over to Speed Post or
          another designated logistics provider, the order cannot ordinarily be cancelled or refunded
          because of change of mind, refusal to accept delivery or voluntary cancellation. This does
          not limit statutory remedies available under applicable law.
        </p>
      </Section>

      <Section heading="21. SpeakEdge Book — Sealed Packaging">
        <p>
          A physical SpeakEdge Book containing an Activation Code is supplied in sealed protective
          packaging. Customers should inspect the external condition of the package before opening
          it. Because the unique membership Activation Code is contained inside the package, opening
          or tampering with the seal may expose the activation credential.
        </p>
        <p>
          Once the sealed packaging has been opened, torn, damaged or tampered with, the SpeakEdge
          Book will not ordinarily be eligible for a change-of-mind return or refund, regardless of
          whether the Activation Code has subsequently been used.
        </p>
        <p>
          Once the Activation Code or associated membership benefit has been activated, the book and
          associated activation benefit are personal and cannot be returned, transferred or refunded
          for change of mind.
        </p>
      </Section>

      <Section heading="22. Direct Office Purchase — 24-Hour Return Rule">
        <p>
          Where a SpeakEdge Book is purchased physically and directly from an authorised Sujyoti
          EdTech/SpeakEdge office, a change-of-mind return request must be made within 24 hours from
          the time of purchase. Such return will be considered only where:
        </p>
        <Bullets
          items={[
            'the book remains unused;',
            'the original sealed packaging remains completely unopened and intact;',
            'the Activation Code has not been exposed or activated; and',
            'the original receipt or valid proof of purchase is produced.',
          ]}
        />
        <p>
          After 24 hours from the time of purchase, the SpeakEdge Book will not ordinarily be accepted
          for return or refund because of change of mind, even if its sealed packaging remains intact.
          If the seal has been opened or tampered with, a change-of-mind return will not ordinarily be
          accepted even within the 24-hour period.
        </p>
        <p>
          Nothing in this section limits statutory rights concerning defective, damaged, incorrect or
          materially misdescribed goods.
        </p>
      </Section>

      <Section heading="23. Other Sujyoti Publications Books">
        <p>
          Books other than the eligible SpeakEdge Book may be sold through the SpeakEdge Book Shop
          under Sujyoti Publications. Unless expressly stated otherwise, such books:
        </p>
        <Bullets
          items={[
            'do not contain a SpeakEdge Activation Code;',
            'do not include SpeakEdge Membership; and',
            'do not independently provide access to the SpeakEdge learning ecosystem.',
          ]}
        />
      </Section>

      <Section heading="24. Purchases from Authorised Partners">
        <p>
          SpeakEdge/Sujyoti Publications books may be sold through authorised bookstores,
          educational institutes, institutional partners, individual authorised partners or other
          authorised sellers. Customers should obtain and retain a valid invoice, receipt or other
          approved proof of purchase.
        </p>
        <p>
          Payment, physical-book cancellation and return requests should ordinarily be raised with the
          authorised seller from whom the book was purchased, subject to that seller&apos;s disclosed
          policy and applicable law.
        </p>
        <p>
          For an eligible SpeakEdge Book, entitlement to the associated 1-year Tribe Membership
          remains subject to verification by Sujyoti EdTech Pvt. Ltd. Sujyoti EdTech may request proof
          of purchase and relevant book/activation information before activating membership. A
          cancelled, refunded, returned, fraudulent, unauthorised or otherwise invalid purchase will
          not qualify for a new membership activation.
        </p>
      </Section>

      <Section heading="25. Amazon, Flipkart and Other Marketplace Purchases">
        <p>
          SpeakEdge Books may be sold through authorised third-party marketplaces such as Amazon,
          Flipkart or other approved marketplaces. Cancellation, physical return, replacement, refund
          and delivery matters concerning marketplace purchases will ordinarily be governed by the
          applicable marketplace/seller policy and applicable law.
        </p>
        <p>
          To receive the applicable 1-year Tribe Membership associated with an eligible SpeakEdge Book
          purchased through an authorised third-party marketplace, the purchaser must provide valid
          proof of purchase to Sujyoti EdTech. Submit proof of purchase to:
        </p>
        <p>
          Email: <SupportEmail />
        </p>
        <p>
          WhatsApp: <SupportWhatsApp />
        </p>
        <p>
          After receiving valid proof of purchase, a SpeakEdge executive will ordinarily contact the
          purchaser on the provided contact number within 72 hours for verification and the next
          steps. Following successful verification, the purchaser will receive the applicable
          Verification/Activation Code or other required activation credential.
        </p>
        <p>
          If the marketplace purchase is subsequently cancelled, returned, refunded or determined to
          be fraudulent or otherwise invalid, Sujyoti EdTech may withhold or deactivate the membership
          benefit associated solely with that purchase, subject to applicable law.
        </p>
      </Section>

      <Section heading="26. Defective, Damaged, Incorrect or Misdescribed Books">
        <p>
          The change-of-mind restrictions in these Terms do not remove statutory consumer rights.
          Where a customer receives a book that is defective, materially damaged, incorrect or
          materially different from what was represented or ordered, the customer should promptly
          contact the relevant seller with purchase details and reasonable supporting evidence.
          Eligible cases will be addressed through replacement, refund or another appropriate remedy
          according to applicable law and the circumstances of the case.
        </p>
      </Section>

      <Section heading="Membership Verification">
        <p>
          SpeakEdge membership activation is subject to successful verification of the information and
          documents submitted by the learner. Learners are required to provide a valid Identity Proof
          and Academic Qualification/Educational Proof as part of the membership verification process.
        </p>
        <p>
          Identity Proof is collected for identity and membership verification and to support the
          integrity and safety of the SpeakEdge platform and Speaking Community. Academic
          Qualification/Educational Proof is collected to verify and understand the learner&apos;s
          educational background and to maintain an appropriate learner profile.
        </p>
        <p>SpeakEdge learning sections are determined primarily according to the learner&apos;s age:</p>
        <Bullets items={['Kids Section: 9–15 years', 'Adult Section: 16 years and above']} />
        <p>
          Submission and successful verification of the required documents are conditions of
          membership activation. A learner who chooses not to provide the required verification
          documents may not be able to activate or access the applicable SpeakEdge membership
          services.
        </p>
        <p>
          Required verification documents will be processed in accordance with the{' '}
          <a href="/privacy" className="font-medium text-brand hover:underline">
            SpeakEdge Privacy Policy
          </a>{' '}
          and will not be displayed to other SpeakEdge members. Voluntary refusal or failure to
          provide the mandatory verification documents does not, by itself, create an entitlement to a
          refund of an otherwise non-refundable fee, subject to applicable law.
        </p>
      </Section>

      <GroupHeading>AI-Guided Learning</GroupHeading>

      <Section heading="27. SpeakEdge Prompt Library">
        <p>
          Eligible SpeakEdge members may receive access to a Prompt Library through their SpeakEdge
          profile. The Prompt Library contains SpeakEdge-designed prompts and learning instructions
          intended to support AI-guided English speaking and communication practice. Access depends
          upon the learner&apos;s applicable membership and platform entitlement.
        </p>
      </Section>

      <Section heading="28. Third-Party AI Platforms">
        <p>
          SpeakEdge prompts may be used with compatible independent third-party artificial
          intelligence platforms, including services such as ChatGPT, Claude, Gemini, Microsoft
          Copilot and other compatible AI services. These services are independently owned, operated
          and controlled by their respective providers and are not operated or controlled by Sujyoti
          EdTech Pvt. Ltd.
        </p>
        <p>
          SpeakEdge does not guarantee the continued availability, compatibility, functionality,
          accuracy, response quality, pricing, usage limits, model availability or performance of any
          third-party AI platform. Third-party providers may independently modify their models,
          interfaces, features, subscriptions, account requirements, usage limits, policies or
          services. Such changes are outside the control of SpeakEdge.
        </p>
        <p>
          AI-generated responses may vary between providers, models, accounts and over time. SpeakEdge
          therefore does not guarantee that a particular prompt will always generate the same
          response, quality or learning experience.
        </p>
      </Section>

      <Section heading="29. Third-Party AI Accounts, Charges and Privacy">
        <p>
          Unless expressly stated otherwise, SpeakEdge Membership does not include a paid subscription
          to any independent third-party AI platform. Any registration, subscription or payment
          required by a third-party AI provider is the learner&apos;s responsibility. Learners are
          also responsible for complying with the applicable AI provider&apos;s terms, privacy
          policies, age requirements and usage rules.
        </p>
        <p>
          Learners should avoid unnecessarily submitting personal, confidential, financial or other
          sensitive information to third-party AI services. SpeakEdge is not responsible for
          independent changes, interruptions, restrictions, responses or data practices of third-party
          AI providers, except to the extent responsibility cannot lawfully be excluded.
        </p>
      </Section>

      <GroupHeading>Platform &amp; Community</GroupHeading>

      <Section heading="30. Speaking Community Conduct">
        <p>
          The Speaking Community exists for English communication practice and appropriate learner
          interaction. Harassment, bullying, threats, abusive or discriminatory behaviour, sexually
          inappropriate conduct, fraud, impersonation, spam, unauthorised commercial solicitation,
          misuse of another person&apos;s personal information and unlawful conduct are prohibited.
        </p>
        <p>
          Members must comply with the separate{' '}
          <a href="/community-rules" className="font-medium text-brand hover:underline">
            Speaking Community Rules
          </a>{' '}
          and{' '}
          <a href="/safety-policy" className="font-medium text-brand hover:underline">
            Community Safety Policy
          </a>
          . SpeakEdge may warn, restrict, suspend or terminate Community access for material
          violations. Serious safety, fraud or misconduct concerns may result in immediate restriction
          or suspension pending review.
        </p>
      </Section>

      <Section heading="31. Classes and Attendance">
        <p>
          Learners are responsible for attending Teacher-led Classes scheduled or confirmed with their
          consent. Failure to attend a scheduled class does not ordinarily entitle the learner to a
          replacement class, extension, credit or refund.
        </p>
        <p>
          SpeakEdge may reasonably reschedule classes because of teacher availability, operational
          requirements, technical problems, emergencies or circumstances beyond reasonable control.
          Where SpeakEdge cancels or materially reschedules a class, an appropriate alternative
          arrangement will be provided where reasonably practicable.
        </p>
      </Section>

      <Section heading="32. Account and Credential Security">
        <p>
          Members are responsible for protecting their Student ID, password, Activation Code,
          Verification Code and other account credentials. Credentials must not be shared. Members
          should promptly notify SpeakEdge if they believe their credentials have been compromised or
          used without authorisation. SpeakEdge may require reasonable identity, purchase or account
          verification for security and prevention of misuse.
        </p>
      </Section>

      <Section heading="33. Intellectual Property">
        <p>
          The SpeakEdge Book, platform, Prompt Library, prompts, learning methodology, course
          structures, materials, assessments, examination content, videos, graphics, designs,
          trademarks, branding and other proprietary content are owned by or licensed to Sujyoti
          EdTech Pvt. Ltd., as applicable. Such materials are provided solely for authorised personal
          educational use.
        </p>
        <p>
          Without prior written permission, users may not reproduce, record, distribute, publish,
          sell, sublicense, commercially exploit or otherwise misuse SpeakEdge proprietary content.
          Purchase of a book or membership does not transfer ownership of intellectual property.
        </p>
        <p>
          Names and trademarks belonging to third-party AI platforms or other organisations remain the
          property of their respective owners. References to them do not imply partnership,
          sponsorship or endorsement unless expressly stated.
        </p>
      </Section>

      <Section heading="34. Privacy and Personal Data">
        <p>
          SpeakEdge may collect and process personal information necessary for registration,
          membership administration, verification, payments, book delivery, learning services,
          Community participation, assessments, certification and support. Personal information will
          be handled in accordance with the{' '}
          <a href="/privacy" className="font-medium text-brand hover:underline">
            SpeakEdge Privacy Policy
          </a>{' '}
          and applicable Indian law. Where legally required, appropriate notice and/or consent will be
          obtained.
        </p>
      </Section>

      <Section heading="35. Minors">
        <p>
          Where a learner is a minor, applicable parent or lawful guardian consent/authorisation may
          be required for registration, personal-data processing, Community participation and other
          services in accordance with applicable law and SpeakEdge policies. Parents or guardians are
          responsible for ensuring that information submitted on behalf of a minor is accurate and
          that the learner complies with applicable Community and safety requirements.
        </p>
      </Section>

      <Section heading="36. Other Third-Party Services">
        <p>
          SpeakEdge may use independent third-party providers for payment processing, hosting,
          communication, video conferencing, logistics and other operational or technological
          services. Use of such services may also be subject to the respective provider&apos;s terms
          and privacy practices. SpeakEdge is not responsible for independent acts, interruptions or
          failures of such providers except to the extent responsibility cannot lawfully be excluded.
        </p>
      </Section>

      <Section heading="37. Platform Availability">
        <p>
          SpeakEdge aims to maintain reliable platform access but does not guarantee uninterrupted or
          error-free operation at all times. Temporary interruptions may occur because of maintenance,
          upgrades, infrastructure or internet failure, third-party service interruption, security
          requirements or circumstances beyond reasonable control. Material service issues
          attributable to SpeakEdge will be addressed according to applicable law and relevant
          SpeakEdge policies.
        </p>
      </Section>

      <Section heading="38. Suspension or Termination">
        <p>
          SpeakEdge may reasonably restrict, suspend or terminate an account or particular service
          because of:
        </p>
        <Bullets
          items={[
            'material breach of these Terms;',
            'fraud;',
            'misuse of membership or credentials;',
            'serious Community or safety violations;',
            'unauthorised exploitation/distribution of content;',
            'threats to platform/member security; or',
            'unlawful conduct.',
          ]}
        />
        <p>
          Where appropriate, SpeakEdge may provide notice or an opportunity to address a violation.
          Serious fraud, security, safety or legal concerns may require immediate action. Suspension
          or termination resulting from a member&apos;s material breach does not automatically create
          a refund entitlement, subject to applicable law.
        </p>
      </Section>

      <Section heading="39. Changes to Services and Benefits">
        <p>
          SpeakEdge may improve, update, replace or modify platform functionality as its services
          develop. SpeakEdge will not retrospectively remove a material paid benefit already promised
          to an existing learner merely by changing these Terms, except where reasonably necessary
          because of applicable law, safety/security requirements, circumstances beyond reasonable
          control, or where an appropriate equivalent or reasonably comparable alternative is
          provided.
        </p>
        <p>
          Changes independently made by third-party AI platforms or other third-party providers do not
          constitute changes made by SpeakEdge.
        </p>
      </Section>

      <Section heading="40. Changes to These Terms">
        <p>
          Sujyoti EdTech may update these Terms to reflect changes in services, technology, policies,
          operations or applicable law. Material changes will be communicated through the platform or
          another appropriate communication channel. The current version will display its latest
          update/effective date.
        </p>
      </Section>

      <Section heading="41. Grievance Redressal and Customer Support">
        <p>
          Questions, complaints or grievances concerning books, membership, payments, activation,
          assessments, privacy or SpeakEdge services may be submitted through the official contact
          channels published on the SpeakEdge website. Sujyoti EdTech Pvt. Ltd. will maintain
          grievance-redressal information and procedures as required under applicable Indian law. The
          applicable Grievance Officer&apos;s name, designation and contact details will be published
          where legally required.
        </p>
      </Section>

      <Section heading="42. Governing Law and Jurisdiction">
        <p>
          These Terms are governed by the laws of India. Subject to mandatory statutory rights and
          forums available under applicable law, disputes arising out of or relating to these Terms or
          SpeakEdge services shall be subject to the exclusive jurisdiction of the competent courts
          having jurisdiction over Barasat, North 24 Parganas, West Bengal, provided such courts
          otherwise have jurisdiction under applicable law.
        </p>
        <p>
          Nothing in this clause prevents a consumer from approaching a competent Consumer Commission
          or another statutory authority or forum having jurisdiction under applicable law.
        </p>
      </Section>

      <Section heading="43. Contact">
        <p>SpeakEdge — A Product of Sujyoti EdTech Pvt. Ltd.</p>
        <p>
          Email: <SupportEmail />
        </p>
        <p>
          WhatsApp / Mobile: <SupportWhatsApp />
        </p>
        <p>
          The registered-office and applicable grievance-redressal details of Sujyoti EdTech Pvt. Ltd.
          will be maintained on the SpeakEdge website.
        </p>
      </Section>

      <Section heading="44. Acceptance of Terms">
        <p>
          By purchasing a book, purchasing or activating a SpeakEdge Membership, or using SpeakEdge
          products or services, you acknowledge that you have read, understood and agreed to these
          Terms &amp; Conditions. Users should also review the applicable:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <a href="/privacy" className="font-medium text-brand hover:underline">
              Privacy Policy
            </a>
          </li>
          <li>
            <a href="/refund-policy" className="font-medium text-brand hover:underline">
              Cancellation &amp; Refund Policy
            </a>
          </li>
          <li>
            <a href="/community-rules" className="font-medium text-brand hover:underline">
              Speaking Community Rules
            </a>
          </li>
          <li>
            <a href="/safety-policy" className="font-medium text-brand hover:underline">
              Community Safety Policy
            </a>
          </li>
          <li>
            <a href="/faq" className="font-medium text-brand hover:underline">
              FAQ
            </a>
          </li>
          <li>assessment and class rules; and</li>
          <li>other applicable policies displayed on the SpeakEdge platform.</li>
        </ul>
        <p>
          Where any provision of these Terms conflicts with a mandatory right available under
          applicable Indian law, the applicable statutory provision will prevail to the extent
          required by law.
        </p>
      </Section>
    </Doc>
  );
}

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How do I get started with SpeakEdge?',
    a: 'Choose your SpeakEdge membership, obtain your SpeakEdge Book and complete the membership activation and verification process. After successful activation, you can access the benefits included in your selected membership, such as AI-guided practice, Speaking Community access, Teacher-led Classes and assessments, where applicable.',
  },
  {
    q: 'What does SpeakEdge membership cost?',
    a: (
      <>
        SpeakEdge membership starts at ₹799. Membership plans may include a one-time
        Membership/Admission Fee, a monthly Teacher-led Class fee, or both, depending on the
        selected plan. Please refer to the{' '}
        <a href="/plans" className="font-medium text-brand hover:underline">
          Membership Plans
        </a>{' '}
        page for current prices, validity and benefits.
      </>
    ),
  },
  {
    q: 'Is the SpeakEdge Book included?',
    a: 'Yes. The SpeakEdge Book is included with every SpeakEdge membership plan and serves as the structured learning and practice guide for your SpeakEdge learning journey.',
  },
  {
    q: 'What is the Activation Code?',
    a: "The Activation Code is a unique, single-use code used to activate an eligible SpeakEdge membership and generate the learner's permanent SpeakEdge Student ID. Depending on the mode of purchase, the Activation Code may be provided with the SpeakEdge Book or issued electronically after successful purchase verification.",
  },
  {
    q: 'Is membership verification required?',
    a: 'Yes. SpeakEdge membership activation is subject to successful verification of the required information and documents, including applicable Identity Proof and Academic/Educational Proof. The verification process may take up to 72 hours.',
  },
  {
    q: 'What is the NRP Method?',
    a: 'The SpeakEdge™ NRP (Natural Reception Power) Method follows the principle of developing communication naturally through exposure, understanding, practice, interaction and repetition — similar to the way people acquire their first language. Rather than depending primarily on memorisation and translation, learners practise using English through meaningful communication.',
  },
  {
    q: 'Can I choose British, American or International English?',
    a: 'Yes. Learners can select British English, American English or International English as their preferred English variety. Applicable SpeakEdge learning resources and Prompt Library activities are designed to follow the selected preference.',
  },
  {
    q: 'Does SpeakEdge provide its own AI application?',
    a: 'SpeakEdge provides structured learning activities and a Prompt Library that learners may use with supported third-party AI services. Third-party AI platforms operate independently. Their availability, features, performance, pricing and policies are controlled by their respective providers and may change from time to time.',
  },
  {
    q: 'How much time should I practise each day?',
    a: "Regular practice is recommended. Around 20 minutes of focused daily practice can be a useful learning routine, although the appropriate amount of practice may vary according to the learner's level, goals and learning pace.",
  },
  {
    q: 'What is the Speaking Community?',
    a: 'The Speaking Community is a members-only environment where eligible learners can connect with Individual Speaking Partners, Conversation Teams and other Community activities for English communication practice. The duration and available features of Speaking Community access depend on the selected membership plan.',
  },
  {
    q: 'Do I get a certificate?',
    a: "Eligible membership plans include a specified number of assessments and applicable SpeakEdge certificates. SpeakEdge conducts CEFR-referenced Speaking Level Assessments to assess speaking proficiency with reference to CEFR levels. SpeakEdge also conducts its own Speaking Test, using assessment criteria informed by the IELTS Speaking framework, including Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy and Pronunciation. SpeakEdge is an independent English-learning and assessment provider and is not an official CEFR organisation, IELTS test centre or IELTS awarding body. SpeakEdge certificates and assessment reports represent SpeakEdge's own assessment results.",
  },
  {
    q: 'Is SpeakEdge available for kids?',
    a: (
      <>
        Yes. For SpeakEdge learning purposes:
        <Bullets
          items={['Kids Section: 8–15 years', 'Adult Section: 16 years and above']}
        />
        Learning topics and activities are adapted according to the learner&apos;s age and
        suitability. Job Interview practice is available for adult learners. Learners under 18
        remain subject to applicable parent/legal guardian consent and additional Community safety
        requirements.
      </>
    ),
  },
  {
    q: 'Can I upgrade my membership later?',
    a: 'Yes. Eligible learners can upgrade to a higher SpeakEdge membership. The applicable previous Membership/Admission Fee may be adjusted against the Admission Fee of the upgraded membership in accordance with the applicable Membership Plans and Terms & Conditions.',
  },
  {
    q: 'What happens if I stop paying the monthly fee?',
    a: 'For memberships with Teacher-led Classes, non-payment of the next monthly fee will suspend Teacher-led Classes. Other eligible membership benefits will remain available during their applicable membership validity. Learners may restart Teacher-led Classes during their valid membership period by paying the applicable monthly fee, subject to batch availability.',
  },
  {
    q: 'How long is my membership valid?',
    a: (
      <>
        Membership validity depends on the selected plan:
        <Bullets items={VALIDITY} />
        Applicable membership benefits must be used within the relevant membership validity period.
      </>
    ),
  },
  {
    q: 'Can I try SpeakEdge before enrolling?',
    a: (
      <>
        Yes. You can book a{' '}
        <a href="/demo" className="font-medium text-brand hover:underline">
          Free Demo
        </a>{' '}
        through the SpeakEdge website to understand how the SpeakEdge learning ecosystem works
        before choosing a membership.
      </>
    ),
  },
  {
    q: 'What if I have another question?',
    a: (
      <>
        Contact SpeakEdge Support:
        <br />
        WhatsApp / Mobile: <SupportWhatsApp />
        <br />
        Email: <SupportEmail />
      </>
    ),
  },
];

export function FaqPage() {
  return (
    <Doc title="Frequently Asked Questions">
      <div className="space-y-3">
        {FAQS.map((f) => (
          <details key={f.q} className="group rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer list-none font-semibold text-slate-900 marker:hidden">
              {f.q}
            </summary>
            <div className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</div>
          </details>
        ))}
      </div>
    </Doc>
  );
}

export function CommunityRulesPage() {
  return (
    <Doc
      title="Speaking Community Rules"
      updated={LAST_UPDATED}
      toc={COMMUNITY_RULES_TOC}
      badge="Community guidelines"
    >
      <Lead>
        The SpeakEdge Speaking Community exists to provide members with a safe and supportive
        environment for practising English communication with other learners through Individual
        Speaking Partners, Conversation Teams and other Community activities, according to the
        benefits available under the learner&apos;s membership. These Rules apply to every member
        participating in the SpeakEdge Speaking Community and should be read together with the{' '}
        <a href="/terms">Terms &amp; Conditions</a> and{' '}
        <a href="/safety-policy">Community Safety Policy</a>.
      </Lead>

      <Section heading="1. Speak Respectfully">
        <p>
          Treat every member as a fellow learner. Mistakes are a natural part of learning. Members
          must not engage in:
        </p>
        <Bullets
          items={[
            'harassment, bullying or threats;',
            'abusive, insulting or discriminatory behaviour;',
            'sexually explicit or inappropriate communication;',
            'intimidation or persistent unwanted contact; or',
            'any other seriously inappropriate or unlawful behaviour.',
          ]}
        />
        <p>
          Disagreements should be handled respectfully. Never mock, humiliate or deliberately
          discourage another learner.
        </p>
      </Section>

      <Section heading="2. Use the Community for English Practice">
        <p>
          The Speaking Community is intended primarily for English-speaking and communication
          practice and appropriate learner interaction. The following are not permitted:
        </p>
        <Bullets
          items={[
            'advertising or selling products/services without authorisation;',
            'recruiting members for unrelated organisations or activities;',
            'promoting competing or unrelated commercial services;',
            'spam or chain messages;',
            'fraudulent activity; or',
            'repeated communication unrelated to the legitimate purpose of the Community.',
          ]}
        />
      </Section>

      <Section heading="3. Respect Privacy">
        <p>
          Members must respect the privacy and personal information of other learners. Do not share
          or publish another member&apos;s:
        </p>
        <Bullets
          items={[
            'phone or WhatsApp number;',
            'home address or location;',
            'photographs;',
            'identity or academic documents;',
            'financial information; or',
            'other private or confidential information without appropriate permission or lawful authority.',
          ]}
        />
        <p>
          Members must not record, reproduce, publish or distribute private chats, speaking sessions
          or Community interactions without appropriate permission, except where reasonably necessary
          to report a genuine safety concern or as otherwise permitted by law.
        </p>
      </Section>

      <Section heading="4. Speaking Partners and Conversation Teams">
        <p>
          Members should use Individual Speaking Partners and Conversation Teams responsibly and for
          genuine English communication practice. Members should:
        </p>
        <Bullets
          items={[
            'communicate respectfully;',
            'honour agreed speaking arrangements where reasonably possible;',
            'inform partners/team members when unable to participate;',
            'avoid repeatedly disturbing or contacting members who have declined an interaction; and',
            "respect another member's decision to leave or end a conversation or speaking arrangement.",
          ]}
        />
        <p>
          Availability of Speaking Partners, Conversation Teams and other Community features depends
          on the applicable membership benefits and validity. Your Terms provide Community access
          according to the selected membership rather than as lifetime access.
        </p>
      </Section>

      <Section heading="5. Protect Your Account">
        <p>Each SpeakEdge membership and Student ID is personal and non-transferable. Members must not:</p>
        <Bullets
          items={[
            'share their Student ID, password, Activation Code, Verification Code or other account credentials;',
            'allow another person to use their account;',
            'impersonate another learner; or',
            'create or operate accounts fraudulently.',
          ]}
        />
        <p>
          Members should promptly notify SpeakEdge if they believe their account or credentials have
          been compromised. This is consistent with the account-security requirements in the Terms.
        </p>
      </Section>

      <Section heading="6. Younger Learners and Minors">
        <p>For SpeakEdge learning purposes:</p>
        <Bullets items={['Kids Section: 8–15 years', 'Adult Section: 16 years and above']} />
        <p>
          These are SpeakEdge learning categories. A learner below 18 years of age remains a minor for
          applicable consent, privacy and safety requirements. Members must comply with all additional
          safety requirements applicable to younger learners and minors. Adult members must not seek
          inappropriate private contact with minors, request their private personal information or
          engage in any inappropriate, exploitative or unsafe behaviour towards them.
        </p>
        <p>
          Parents/legal guardians of minor learners should review the{' '}
          <a href="/safety-policy" className="font-medium text-brand hover:underline">
            Community Safety Policy
          </a>{' '}
          and applicable Terms governing participation by minors.
        </p>
      </Section>

      <Section heading="7. No Unauthorised Commercial or Financial Activity">
        <p>Members must not use the Speaking Community to:</p>
        <Bullets
          items={[
            'ask other members for money, loans, gifts or fees;',
            'collect payments for unauthorised services;',
            'conduct unauthorised business;',
            'promote investment or financial schemes; or',
            'solicit members for commercial purposes.',
          ]}
        />
        <p>
          Official SpeakEdge payments should be made only through authorised SpeakEdge payment
          channels.
        </p>
      </Section>

      <Section heading="8. Blocking and Reporting">
        <p>
          If another member behaves inappropriately, makes you uncomfortable or appears to violate
          these Rules, you may use the available Block and Report features. Reports will be reviewed
          by the SpeakEdge team and appropriate action may be taken depending on the circumstances.
        </p>
        <p>
          Members must not knowingly submit false or malicious reports against other members.
        </p>
      </Section>

      <Section heading="9. If the Rules Are Broken">
        <p>
          Depending on the nature, seriousness and circumstances of a violation, SpeakEdge may:
        </p>
        <Bullets
          items={[
            'issue a warning;',
            'restrict particular Community features;',
            'temporarily suspend Community access;',
            'restrict or suspend an account while a serious matter is reviewed; or',
            'terminate Community access or membership in serious cases.',
          ]}
        />
        <p>
          Serious safety, fraud or misconduct concerns may result in immediate restriction or
          suspension pending review, consistent with the{' '}
          <a href="/terms" className="font-medium text-brand hover:underline">
            Terms &amp; Conditions
          </a>
          .
        </p>
        <p>
          Restriction, suspension or termination resulting from a member&apos;s material breach does
          not automatically create an entitlement to a refund. Any refund entitlement remains subject
          to the Terms &amp; Conditions,{' '}
          <a href="/refund-policy" className="font-medium text-brand hover:underline">
            Cancellation &amp; Refund Policy
          </a>{' '}
          and applicable law.
        </p>
      </Section>

      <Section heading="10. Follow the Community Safety Policy">
        <p>
          All members must also comply with the SpeakEdge{' '}
          <a href="/safety-policy" className="font-medium text-brand hover:underline">
            Community Safety Policy
          </a>, particularly the requirements relating to personal information, minors, private
          contact, meetings outside SpeakEdge, account security, blocking and reporting.
        </p>
        <p>
          By participating in the Speaking Community, members agree to follow these Rules together
          with the applicable{' '}
          <a href="/terms" className="font-medium text-brand hover:underline">
            Terms &amp; Conditions
          </a>
          ,{' '}
          <a href="/privacy" className="font-medium text-brand hover:underline">
            Privacy Policy
          </a>{' '}
          and Community Safety Policy.
        </p>
        <p>Report Community concerns:</p>
        <ContactBox>
          <p>
            Email: <SupportEmail />
          </p>
          <p className="mt-1">
            WhatsApp / Mobile: <SupportWhatsApp />
          </p>
        </ContactBox>
      </Section>
    </Doc>
  );
}

export function SafetyPolicyPage() {
  return (
    <Doc title="Community Safety Policy" updated={LAST_UPDATED}>
      <p>
        The SpeakEdge Speaking Community enables members to practise English and develop communication
        skills through interaction with other learners. This Community Safety Policy explains the
        safety requirements applicable to members participating in Speaking Community activities. This
        Policy should be read together with the{' '}
        <a href="/terms" className="font-medium text-brand hover:underline">
          SpeakEdge Terms &amp; Conditions
        </a>{' '}
        and{' '}
        <a href="/community-rules" className="font-medium text-brand hover:underline">
          Speaking Community Rules
        </a>
        .
      </p>

      <Section heading="1. Verified Membership">
        <p>
          Participation in the Speaking Community is available only to eligible SpeakEdge members who
          have completed the applicable membership verification process. Members are required to
          provide valid Identity Proof and Academic Qualification/Educational Proof as part of
          membership verification.
        </p>
        <p>
          Each verified learner is assigned a permanent SpeakEdge Student ID. Membership, Student ID
          and account credentials are personal and non-transferable. Verification is intended to
          support membership integrity, member accountability and the safety of the Speaking
          Community.
        </p>
      </Section>

      <Section heading="2. Protect Your Personal Information">
        <p>
          Members should protect their personal and confidential information while interacting with
          other learners. Do not unnecessarily share:
        </p>
        <Bullets
          items={[
            'phone or WhatsApp numbers;',
            'home addresses or precise location;',
            'passwords, OTPs or account credentials;',
            'identity or academic documents;',
            'banking, card, UPI or other financial information; or',
            'other confidential personal information.',
          ]}
        />
        <p>
          SpeakEdge will never require members to share their password or OTP with another community
          member. Be cautious when opening external links, downloading files or responding to requests
          received from other members.
        </p>
      </Section>

      <Section heading="3. Money, Payments and Commercial Requests">
        <p>
          Members must not use the Speaking Community to request or collect money, loans, gifts, fees
          or financial assistance from other members.
        </p>
        <p>
          Do not make payments to another member in connection with SpeakEdge membership, classes,
          assessments or other official SpeakEdge services unless the payment is made through an
          officially authorised SpeakEdge payment channel.
        </p>
        <p>
          Advertising, selling, unauthorised commercial solicitation and promotion of unrelated
          products or services are not permitted within the Speaking Community.
        </p>
      </Section>

      <Section heading="4. Safe and Respectful Interaction">
        <p>
          Members must communicate respectfully and use the Speaking Community primarily for
          English-speaking and communication practice. The following conduct is prohibited:
        </p>
        <Bullets
          items={[
            'harassment, bullying or threats;',
            'abusive or discriminatory behaviour;',
            'sexually explicit or inappropriate communication;',
            'stalking or persistent unwanted contact;',
            'impersonation or fraudulent behaviour;',
            'spam or unauthorised solicitation;',
            "attempts to obtain another member's confidential information; and",
            'any unlawful or seriously unsafe conduct.',
          ]}
        />
        <p>
          Members should respect another member&apos;s decision to end or decline an interaction.
        </p>
      </Section>

      <Section heading="5. Younger Learners and Minors">
        <p>For SpeakEdge learning purposes:</p>
        <Bullets items={['Kids Section: 8–15 years', 'Adult Section: 16 years and above']} />
        <p>
          These are SpeakEdge learning categories. A learner below 18 years of age remains a minor for
          applicable consent, privacy and safety requirements, even where the learner participates in
          the Adult Section. Learners under 18 are subject to additional parental/guardian consent and
          Community safety requirements.
        </p>
        <p>
          Adult members must not seek inappropriate private contact with a minor, request a
          minor&apos;s private contact details, or attempt to move communication with a minor to
          private external communication channels for inappropriate purposes.
        </p>
        <p>
          Any suspected exploitation, grooming, sexual misconduct or other serious inappropriate
          behaviour involving a minor may result in immediate restriction or suspension of the
          relevant account while the matter is reviewed.
        </p>
      </Section>

      <Section heading="6. Meetings Outside SpeakEdge">
        <p>
          SpeakEdge does not arrange, supervise or endorse private in-person meetings between Community
          members outside authorised SpeakEdge activities. Members who independently choose to
          communicate or meet outside the SpeakEdge platform do so outside SpeakEdge&apos;s supervision
          and should exercise appropriate caution.
        </p>
        <p>
          Members under 18 must not arrange private in-person meetings with other Community members
          through SpeakEdge. SpeakEdge strongly discourages members from sharing their home address or
          other sensitive location information for the purpose of arranging private meetings.
        </p>
      </Section>

      <Section heading="7. Photos, Recordings and Personal Information of Others">
        <p>
          Members must respect the privacy of other learners. Do not photograph, screenshot,
          audio-record, video-record, reproduce, publish or distribute another member&apos;s private
          communication, image or speaking session without appropriate permission, except where
          reasonably necessary to report a genuine safety concern to SpeakEdge or as otherwise
          permitted by law.
        </p>
        <p>
          Never publish or distribute another member&apos;s identity documents, contact details,
          address or other private information without lawful authority.
        </p>
      </Section>

      <Section heading="8. Blocking and Reporting">
        <p>
          Members may use available platform features to block or report another member where they
          feel uncomfortable, experience inappropriate behaviour or believe that Community rules have
          been violated. Reports will be reviewed by the SpeakEdge team and appropriate action may be
          taken depending on the nature and seriousness of the matter.
        </p>
        <p>
          SpeakEdge will handle information relating to reports in accordance with its{' '}
          <a href="/privacy" className="font-medium text-brand hover:underline">
            Privacy Policy
          </a>{' '}
          and applicable law. While reasonable steps may be taken to protect a reporter&apos;s privacy,
          absolute confidentiality cannot be guaranteed where disclosure is reasonably necessary for
          investigation, safety, legal compliance or cooperation with competent authorities.
        </p>
      </Section>

      <Section heading="9. Account and Credential Safety">
        <p>Members are responsible for protecting their:</p>
        <Bullets
          items={[
            'Student ID;',
            'password;',
            'Activation Code;',
            'Verification Code; and',
            'other account credentials.',
          ]}
        />
        <p>
          Account credentials must not be shared with another person. If a member believes that an
          account or credential has been compromised or used without authorisation, the member should
          notify SpeakEdge promptly. SpeakEdge may require reasonable identity or account verification
          before restoring or modifying account access.
        </p>
      </Section>

      <Section heading="10. Consequences of Safety Violations">
        <p>Depending on the nature and seriousness of a violation, SpeakEdge may:</p>
        <Bullets
          items={[
            'issue a warning;',
            'remove or restrict applicable content or Community functionality;',
            'block particular Community privileges;',
            'temporarily suspend Community access;',
            'restrict or suspend an account while a serious matter is investigated; or',
            'terminate Community access or membership in serious cases.',
          ]}
        />
        <p>
          Serious fraud, safety concerns, threats, unlawful conduct or misconduct involving minors may
          result in immediate action without prior warning where reasonably necessary to protect
          members or the platform.
        </p>
        <p>
          Restriction, suspension or termination resulting from a member&apos;s material breach does
          not automatically create an entitlement to a refund, subject to the{' '}
          <a href="/terms" className="font-medium text-brand hover:underline">
            SpeakEdge Terms &amp; Conditions
          </a>
          ,{' '}
          <a href="/refund-policy" className="font-medium text-brand hover:underline">
            Cancellation &amp; Refund Policy
          </a>{' '}
          and applicable law.
        </p>
      </Section>

      <Section heading="11. Legal and Emergency Matters">
        <p>
          Where SpeakEdge reasonably believes that conduct may involve a criminal offence, serious
          threat to safety, fraud, exploitation of a minor or another matter requiring legal
          intervention, Sujyoti EdTech Pvt. Ltd. may preserve relevant information and cooperate with
          competent law-enforcement, regulatory or other authorities as required or permitted by
          applicable law.
        </p>
      </Section>

      <Section heading="12. Contact and Reporting">
        <p>
          Safety concerns, inappropriate behaviour or suspected violations of this Policy may be
          reported to SpeakEdge through its official support channels:
        </p>
        <p>
          Email: <SupportEmail />
          <br />
          WhatsApp / Mobile: <SupportWhatsApp />
        </p>
        <p>
          Members should provide sufficient information to enable SpeakEdge to review the matter, while
          avoiding unnecessary disclosure of sensitive personal information.
        </p>
      </Section>
    </Doc>
  );
}

export function RefundPolicyPage() {
  return (
    <Doc title="Cancellation & Refund Policy" updated={LAST_UPDATED}>
      <p>
        This Cancellation &amp; Refund Policy explains the conditions applicable to cancellation,
        return, replacement and refund requests relating to SpeakEdge memberships, admission fees,
        monthly Teacher-led Class fees and books purchased from Sujyoti EdTech Pvt. Ltd./Sujyoti
        Publications. This Policy should be read together with the{' '}
        <a href="/terms" className="font-medium text-brand hover:underline">
          SpeakEdge Terms &amp; Conditions
        </a>
        . Nothing in this Policy limits any statutory consumer right or remedy available under
        applicable Indian law.
      </p>

      <Section heading="1. Membership and Admission Fees">
        <p>
          Subject to applicable law, Membership Fees and Admission Fees paid towards an activated or
          commenced SpeakEdge membership are non-refundable. No refund will ordinarily be provided
          because of:
        </p>
        <Bullets
          items={[
            'change of mind;',
            'voluntary discontinuation of membership;',
            'non-use or partial use of membership benefits;',
            'failure to participate in the Speaking Community;',
            'failure to use included assessments;',
            'failure to use Student Relation Support; or',
            'expiry of unused membership benefits or entitlements.',
          ]}
        />
        <p>
          A request to discontinue a membership does not, by itself, create an entitlement to a
          refund.
        </p>
      </Section>

      <Section heading="2. Membership Verification">
        <p>
          SpeakEdge membership activation is subject to successful verification of the information and
          mandatory documents submitted by the learner. Learners are required to provide the
          applicable Identity Proof and Academic Qualification/Educational Proof as part of the
          membership verification process.
        </p>
        <p>
          If a learner voluntarily refuses or fails to provide the required verification documents
          after purchase, SpeakEdge may be unable to activate the membership. Such refusal or failure
          does not, by itself, create an entitlement to a refund of an otherwise non-refundable fee,
          subject to applicable law. Verification documents will be processed in accordance with the{' '}
          <a href="/privacy" className="font-medium text-brand hover:underline">
            SpeakEdge Privacy Policy
          </a>
          .
        </p>
      </Section>

      <Section heading="3. Monthly Teacher-led Class Fees">
        <p>
          Monthly Teacher-led Class fees are applicable to eligible SpeakEdge memberships. The first
          monthly period begins from the learner&apos;s first scheduled Teacher-led Class date,
          provided the schedule has been arranged or confirmed with the learner&apos;s consent. One
          month means the period beginning on that date and ending one day before the corresponding
          date in the following month. For example:
        </p>
        <p>
          First scheduled class: 25 January
          <br />
          Monthly period: 25 January to 24 February
        </p>
        <p>
          Once the monthly period has commenced, the applicable monthly fee is non-refundable,
          including where the learner does not attend, partially attends or voluntarily stops
          Teacher-led Classes during that period.
        </p>
        <p>
          Learners may stop future monthly payments. Non-payment of a future monthly fee will suspend
          Teacher-led Classes but will not cancel other eligible membership benefits while the
          applicable membership validity remains active.
        </p>
        <p>
          An eligible learner may restart Teacher-led Classes during the membership validity period by
          paying the applicable monthly fee, subject to batch availability and the applicable Terms
          &amp; Conditions.
        </p>
      </Section>

      <Section heading="4. Classes, Assessments and Other Membership Benefits">
        <p>
          Teacher-led Class entitlements, CEFR-referenced Speaking Level Assessments, SpeakEdge
          Speaking Tests, Speaking Community benefits, Student Relation Support and other benefits
          included in a membership have no separate cash value and are not individually refundable or
          exchangeable for cash.
        </p>
        <p>
          Unused assessments and other fixed membership entitlements expire at the end of the
          applicable membership validity period. Where SpeakEdge cancels a scheduled Teacher-led Class
          or assessment, SpeakEdge may reschedule it or restore the applicable entitlement, as
          appropriate.
        </p>
      </Section>

      <Section heading="5. Online Book Orders – Before Dispatch">
        <p>
          A physical book purchased directly through SpeakEdge/Sujyoti Publications may be cancelled
          before it is dispatched. Where an eligible cancellation is approved, the applicable
          refundable amount will be returned through the appropriate payment method, subject to
          applicable law and any charges that may lawfully be deducted.
        </p>
      </Section>

      <Section heading="6. Online Book Orders – After Dispatch">
        <p>
          Once a physical book has been handed over to Speed Post or another designated logistics
          provider, the order cannot ordinarily be cancelled or refunded because of:
        </p>
        <Bullets
          items={['change of mind;', 'refusal to accept delivery; or', 'voluntary cancellation.']}
        />
        <p>
          This restriction does not affect statutory remedies applicable to defective, materially
          damaged, incorrect or materially misdescribed goods.
        </p>
      </Section>

      <Section heading="7. SpeakEdge Book – Sealed Packaging">
        <p>
          A physical SpeakEdge Book containing an Activation Code is supplied in sealed protective
          packaging. Because opening or tampering with the sealed packaging may expose the unique
          Activation Code, once the packaging has been opened, torn, damaged or tampered with, the
          SpeakEdge Book will not ordinarily be eligible for a change-of-mind return or refund,
          regardless of whether the Activation Code has subsequently been used.
        </p>
        <p>
          Once the Activation Code or associated membership benefit has been activated, the associated
          membership benefit is personal and non-transferable.
        </p>
      </Section>

      <Section heading="8. Direct Office Purchase – 24-Hour Return Rule">
        <p>
          Where a SpeakEdge Book is purchased physically and directly from an authorised Sujyoti
          EdTech/SpeakEdge office, a change-of-mind return request must be made within 24 hours from
          the time of purchase. A return will ordinarily be considered only where:
        </p>
        <Bullets
          items={[
            'the book remains unused;',
            'the original sealed packaging remains completely unopened and intact;',
            'the Activation Code has not been exposed or activated; and',
            'the original receipt or other valid proof of purchase is provided.',
          ]}
        />
        <p>
          After 24 hours from the time of purchase, a SpeakEdge Book will not ordinarily be accepted
          for a change-of-mind return or refund, even if its sealed packaging remains intact. If the
          seal has been opened, damaged or tampered with, a change-of-mind return will not ordinarily
          be accepted even within the 24-hour period.
        </p>
      </Section>

      <Section heading="9. Other Sujyoti Publications Books">
        <p>
          Books other than an eligible SpeakEdge Book do not ordinarily contain a SpeakEdge Activation
          Code or include a SpeakEdge membership benefit. Cancellation, return and refund eligibility
          for such books will depend on the applicable purchase conditions, dispatch status, condition
          of the book and applicable law.
        </p>
      </Section>

      <Section heading="10. Defective, Damaged, Incorrect or Misdescribed Books">
        <p>
          The restrictions applicable to change-of-mind returns do not remove statutory consumer
          rights. Where a customer receives a book that is defective, materially damaged, incorrect or
          materially different from what was ordered or represented, the customer should promptly
          contact the relevant seller with:
        </p>
        <Bullets
          items={[
            'order/purchase details;',
            'a description of the issue; and',
            'reasonable supporting evidence, such as photographs where appropriate.',
          ]}
        />
        <p>
          Eligible cases will be addressed through replacement, refund or another appropriate remedy,
          depending on the circumstances and applicable law.
        </p>
      </Section>

      <Section heading="11. Purchases from Authorised Partners">
        <p>
          SpeakEdge/Sujyoti Publications books may be sold through authorised bookstores,
          educational institutes, institutional partners, individual authorised partners or other
          authorised sellers. For books purchased from an authorised partner, physical-book
          cancellation, return and refund requests should ordinarily be raised with the seller from
          whom the book was purchased, subject to that seller&apos;s disclosed policy and applicable
          law.
        </p>
        <p>
          Eligibility for any SpeakEdge membership benefit associated with an eligible SpeakEdge Book
          remains subject to verification by Sujyoti EdTech Pvt. Ltd. A purchase that has been
          cancelled, returned, refunded, determined to be fraudulent or otherwise found invalid will
          not qualify for a new membership activation.
        </p>
      </Section>

      <Section heading="12. Amazon, Flipkart and Other Marketplace Purchases">
        <p>
          For books purchased through an authorised third-party marketplace such as Amazon, Flipkart
          or another approved marketplace, physical-book cancellation, return, replacement, refund and
          delivery matters will ordinarily be governed by the applicable marketplace/seller policy and
          applicable law.
        </p>
        <p>
          Where an eligible SpeakEdge Book purchased through an authorised marketplace includes a
          SpeakEdge membership benefit, activation remains subject to successful purchase and
          membership verification. If the marketplace purchase is subsequently cancelled, returned,
          refunded, determined to be fraudulent or otherwise invalidated, Sujyoti EdTech may withhold
          or deactivate the membership benefit associated solely with that purchase, subject to
          applicable law.
        </p>
      </Section>

      <Section heading="13. Suspension or Termination for Misuse">
        <p>
          Where SpeakEdge restricts, suspends or terminates a membership or service because of a
          member&apos;s material breach of the{' '}
          <a href="/terms" className="font-medium text-brand hover:underline">
            Terms &amp; Conditions
          </a>
          ,{' '}
          <a href="/community-rules" className="font-medium text-brand hover:underline">
            Speaking Community Rules
          </a>{' '}
          or{' '}
          <a href="/safety-policy" className="font-medium text-brand hover:underline">
            Community Safety Policy
          </a>
          , such restriction, suspension or termination does not automatically create a refund
          entitlement.
        </p>
        <p>
          This may include serious cases involving fraud, misuse of membership credentials, serious
          Community or safety violations, unauthorised exploitation or distribution of SpeakEdge
          content, or unlawful conduct. Any refund entitlement remains subject to applicable law and
          the circumstances of the case.
        </p>
      </Section>

      <Section heading="14. Cancellation, Return, Replacement or Refund Requests">
        <p>
          A customer may submit a cancellation, return, replacement or refund request where eligible
          under this Policy. Eligibility depends on factors including:
        </p>
        <Bullets
          items={[
            'the type of purchase;',
            'whether the order has been dispatched;',
            'the condition and packaging of the product;',
            'whether an Activation Code or membership benefit has been activated;',
            'the reason for the request; and',
            'the mode/place of purchase.',
          ]}
        />
        <p>
          Submission of a request does not automatically mean that a refund, return or replacement is
          due. Each request will be reviewed according to this Policy, the Terms &amp; Conditions and
          applicable law.
        </p>
      </Section>

      <Section heading="15. How to Submit a Request">
        <p>
          To submit an eligible cancellation, return, replacement or refund request, contact SpeakEdge
          with your Order Number or Student ID, the reason for the request and any supporting
          information reasonably required for verification.
        </p>
        <p>
          Email: <SupportEmail />
          <br />
          WhatsApp / Mobile: <SupportWhatsApp />
        </p>
        <p>
          Where a refund is approved, SpeakEdge will initiate the refund through the applicable
          payment method within the communicated processing period. The time taken for the refunded
          amount to appear in the customer&apos;s account may additionally depend on the bank, payment
          gateway or other payment service provider.
        </p>
      </Section>
    </Doc>
  );
}
