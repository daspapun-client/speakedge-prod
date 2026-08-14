/**
 * Static footer pages — Privacy Policy, Terms & Conditions and FAQ.
 * Content is written to match how the platform actually works; the legal
 * wording still needs a final review by the company before launch.
 */

function Doc({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <article className="prose-slate max-w-3xl">
      <h1 className="text-3xl font-extrabold text-slate-900">{title}</h1>
      {updated && <p className="mt-1 text-sm text-slate-500">Last updated: {updated}</p>}
      <div className="mt-6 space-y-6 text-sm leading-relaxed text-slate-600">{children}</div>
    </article>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-bold text-slate-900">{heading}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

const LAST_UPDATED = 'August 2026';

export function PrivacyPage() {
  return (
    <Doc title="Privacy Policy" updated={LAST_UPDATED}>
      <p>
        SpeakEdge is a product of Sujyoti EdTech Pvt. Ltd. This policy explains what information we
        collect when you use the SpeakEdge platform, why we collect it and how you can control it.
      </p>

      <Section heading="Information we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>Account details you provide — name, email address, phone number and date of birth.</li>
          <li>
            Membership enrolment details, including the photograph and identity proof you upload for
            verification.
          </li>
          <li>
            Learning activity — AI practice sessions, speaking and CEFR assessment results, class
            attendance and community interactions.
          </li>
          <li>
            Payment records. Card and banking details are handled by our payment gateway; we store
            only the transaction reference and status.
          </li>
        </ul>
      </Section>

      <Section heading="How we use it">
        <ul className="list-disc space-y-1 pl-5">
          <li>To verify your membership and issue your SpeakEdge student ID.</li>
          <li>To personalise your learning path, AI practice prompts and assessments.</li>
          <li>To connect you with speaking partners, teams and teachers inside the community.</li>
          <li>To send service messages about classes, assessments and membership renewals.</li>
        </ul>
      </Section>

      <Section heading="Sharing">
        <p>
          We do not sell your personal information. Limited data is shared with teachers, examiners
          and partners only where it is needed to deliver the service you have enrolled in, and with
          service providers such as our payment gateway and email provider.
        </p>
      </Section>

      <Section heading="Community visibility">
        <p>
          Your community profile — display name, photo and speaking interests — is visible to other
          SpeakEdge members. You can control what appears on your profile from your dashboard.
        </p>
      </Section>

      <Section heading="Retention">
        <p>
          Records you delete are archived for 60 days before being permanently removed, so that
          accidental deletions can be recovered. Financial records are retained for as long as the
          law requires.
        </p>
      </Section>

      <Section heading="Your choices">
        <p>
          You can view and correct your details from your dashboard, or write to us to request a copy
          of your data or the closure of your account.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about this policy? WhatsApp us on{' '}
          <a href="https://wa.me/918240861168" className="font-medium text-brand hover:underline">
            82408 61168
          </a>
          .
        </p>
      </Section>
    </Doc>
  );
}

export function TermsPage() {
  return (
    <Doc title="Terms & Conditions" updated={LAST_UPDATED}>
      <p>
        These terms govern your use of SpeakEdge, operated by Sujyoti EdTech Pvt. Ltd. By enrolling
        in a membership or using the platform you agree to them.
      </p>

      <Section heading="Membership">
        <p>
          SpeakEdge membership is personal and non-transferable. Your membership is lifetime; the
          learning subscription attached to it runs for the term you select and can be renewed or
          upgraded. Features and access vary according to the membership plan you choose.
        </p>
      </Section>

      <Section heading="The SpeakEdge Book and Activation Code">
        <p>
          Each SpeakEdge Book carries a unique Activation Code used to activate your SpeakEdge access
          after membership enrolment. A code can be activated once, by one member. Sharing, reselling
          or publishing activation codes is not permitted.
        </p>
      </Section>

      <Section heading="Fees and payments">
        <p>
          Membership and admission fees are shown before checkout and charged upfront for the term
          you select. On upgrade, your eligible previous membership or admission fee is adjusted
          against the new plan.
        </p>
      </Section>

      <Section heading="Refunds">
        <p>
          Membership fees, admission fees and activation codes are non-refundable once the code has
          been activated. Book orders that have not yet been dispatched may be cancelled by
          contacting us.
        </p>
      </Section>

      <Section heading="Community conduct">
        <p>
          The Speaking Community exists for English practice. Harassment, abusive language, spam and
          the sharing of others&apos; personal information are not allowed. We may suspend or remove
          access for members who breach these rules.
        </p>
      </Section>

      <Section heading="Classes and assessments">
        <p>
          Live classes run to a published schedule. Where attendance confirmation is requested,
          unconfirmed seats may be released so that the place can be used by another member. CEFR and
          speaking assessments are subject to the number of attempts included in your plan.
        </p>
      </Section>

      <Section heading="Content">
        <p>
          The SpeakEdge Book, learning materials, prompts and assessments are the intellectual
          property of Sujyoti EdTech Pvt. Ltd. and are licensed to you for personal learning use
          only.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          We may update these terms as the platform develops. Material changes will be communicated
          through the platform or by email.
        </p>
      </Section>
    </Doc>
  );
}

const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I get started with SpeakEdge?',
    a: 'Choose your membership, receive your SpeakEdge Book, activate your access with the Activation Code printed inside it, and your full ecosystem opens up — AI practice, the Speaking Community, live learning and CEFR assessment.',
  },
  {
    q: 'What does membership cost?',
    a: 'Membership starts at ₹699. Tribe is a one-time fee with no monthly charge; Silver, Gold and Diamond add a one-time admission fee plus a monthly fee. Full details are on the Membership Plans page.',
  },
  {
    q: 'Is the SpeakEdge Book included?',
    a: 'Yes. The SpeakEdge Book is included with every membership plan. It is your structured learning and practice guide, and it carries the unique Activation Code for your access.',
  },
  {
    q: 'What is the Activation Code?',
    a: 'A unique code printed inside your SpeakEdge Book. You use it once, after membership enrolment, to activate your SpeakEdge access and receive your student ID.',
  },
  {
    q: 'What is the NRP Method?',
    a: 'Natural learning — you learn English the way you learnt your mother tongue. No memorization, just understanding, exposure, communication and natural acquisition.',
  },
  {
    q: 'Can I choose British, American or International English?',
    a: 'Yes. You select your preferred English when you set up your profile, and your AI practice prompts and learning content follow that choice. You can change it later.',
  },
  {
    q: 'How much time do I need each day?',
    a: 'About 20 minutes a day. A short daily habit of book learning, AI practice and human practice compounds into lasting confidence.',
  },
  {
    q: 'What is the Speaking Community?',
    a: 'A members-only space to find speaking partners, join conversation teams and practise English through regular community interaction. The length of community access depends on your plan.',
  },
  {
    q: 'Do I get a certificate?',
    a: 'Yes. CEFR assessment and certification are part of the ecosystem. You receive a report card with a skill breakdown and an examiner-verified, online-verifiable certificate.',
  },
  {
    q: 'Is SpeakEdge for kids too?',
    a: 'Yes. Adults and kids learn the same communication skills — the topics and activities are chosen to suit the learner’s age. Job Interview practice is additional for adult learners.',
  },
  {
    q: 'Can I upgrade my plan later?',
    a: 'Yes. Start at your level and upgrade when you are ready — your eligible previous membership or admission fee is adjusted on upgrade.',
  },
  {
    q: 'Can I try before enrolling?',
    a: 'Yes — book a Free Demo from the website and see how the SpeakEdge ecosystem works.',
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
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</p>
          </details>
        ))}
      </div>
      <p>
        Still have a question? WhatsApp us on{' '}
        <a href="https://wa.me/918240861168" className="font-medium text-brand hover:underline">
          82408 61168
        </a>
        .
      </p>
    </Doc>
  );
}

export function CommunityRulesPage() {
  return (
    <Doc title="Speaking Community Rules" updated={LAST_UPDATED}>
      <p>
        The SpeakEdge Speaking Community exists so that members can practise English with other real
        learners — through individual speaking partners, conversation teams, community classes and
        other community activities, according to the benefits available under your membership. These
        rules apply to every member using any part of the community.
      </p>

      <Section heading="Speak respectfully">
        <p>
          Treat every member as a fellow learner. Mistakes are part of learning — never mock, correct
          rudely or discourage another member. Abusive, threatening, discriminatory or sexually
          explicit language is not permitted anywhere in the community.
        </p>
      </Section>

      <Section heading="Use the community for English practice">
        <p>
          Conversations, chats and classes are for practising English. Advertising, selling,
          recruiting, promoting other services, chain messages and spam are not allowed.
        </p>
      </Section>

      <Section heading="Respect other members&apos; privacy">
        <p>
          Do not share another member&apos;s phone number, address, photographs, identity documents or
          any other personal information, and do not record or republish a class, chat or speaking
          session without the consent of everyone taking part.
        </p>
      </Section>

      <Section heading="Turn up for what you book">
        <p>
          Speaking partners, conversation teams and classes depend on people showing up. Confirm your
          attendance when asked, and cancel in good time if you cannot attend so that your place can
          be offered to another member.
        </p>
      </Section>

      <Section heading="One member, one account">
        <p>
          Your membership and student ID are personal and non-transferable. Do not share your login,
          impersonate another person or create additional accounts.
        </p>
      </Section>

      <Section heading="Report problems">
        <p>
          If another member behaves inappropriately, block them and report it to us. Every report is
          reviewed by the SpeakEdge team.
        </p>
      </Section>

      <Section heading="If the rules are broken">
        <p>
          Depending on what happened, we may issue a warning, remove content, restrict community
          features, suspend community access or, in serious cases, terminate membership. See also our{' '}
          <a href="/safety-policy" className="font-medium text-brand hover:underline">
            Community Safety Policy
          </a>
          .
        </p>
      </Section>
    </Doc>
  );
}

export function SafetyPolicyPage() {
  return (
    <Doc title="Community Safety Policy" updated={LAST_UPDATED}>
      <p>
        SpeakEdge connects learners with each other for speaking practice. This policy explains how we
        keep that space safe, and what we expect from you while participating in speaking activities
        and interacting with other learners.
      </p>

      <Section heading="Who is in the community">
        <p>
          Only members whose identity documents have been verified by the SpeakEdge team can take part
          in the Speaking Community. Every profile carries a permanent student ID, so members are
          accountable for how they behave.
        </p>
      </Section>

      <Section heading="Keep your personal details private">
        <ul className="list-disc space-y-1 pl-5">
          <li>Practise inside SpeakEdge — you do not need to share your phone number, home address or financial details with another member.</li>
          <li>Never send money to another member, and never accept a request for money, gifts or fees.</li>
          <li>Be cautious about links or files sent to you by other members.</li>
        </ul>
      </Section>

      <Section heading="Meeting outside SpeakEdge">
        <p>
          SpeakEdge does not arrange or supervise meetings between members outside the platform. If you
          choose to meet another member in person, you do so at your own risk. We strongly advise
          against private in-person meetings, and members under 18 must not arrange them at all.
        </p>
      </Section>

      <Section heading="Younger learners">
        <p>
          Kids&apos; learning is delivered in age-appropriate groups. Adult members must not seek private
          one-to-one contact with a member who is a minor. Any adult behaving inappropriately towards a
          younger learner is removed from the platform immediately.
        </p>
      </Section>

      <Section heading="Blocking and reporting">
        <p>
          You can block any member from your profile or chat at any time — blocking is immediate and
          the other member is not told. Report anything that concerns you to the SpeakEdge team; reports
          are reviewed and the reporter&apos;s identity is not disclosed to the member reported.
        </p>
      </Section>

      <Section heading="Consequences of misuse">
        <p>
          Misuse of the platform, inappropriate behaviour or violation of community safety requirements
          may result in restriction or suspension of community access, and in serious cases termination
          of membership without refund. Where conduct may be a criminal offence, we will cooperate with
          the appropriate authorities.
        </p>
      </Section>
    </Doc>
  );
}

export function RefundPolicyPage() {
  return (
    <Doc title="Cancellation & Refund Policy" updated={LAST_UPDATED}>
      <p>
        This policy explains when SpeakEdge fees can be cancelled or refunded. It applies to
        membership fees, admission fees, monthly fees and SpeakEdge Book orders bought from
        Sujyoti EdTech Pvt. Ltd.
      </p>

      <Section heading="Before your activation code is used">
        <p>
          If you have paid but have not yet activated your membership, you may request cancellation by
          contacting us. Once approved, the amount is refunded to the original payment method after
          deducting any dispatch or payment-gateway charges already incurred.
        </p>
      </Section>

      <Section heading="After activation">
        <p>
          Once the Activation Code has been used, the membership becomes personal to you and the
          admission/membership fee is not refundable. This is because the code is single-use and the
          full learning ecosystem — book, AI practice, community access and assessments — is released
          at activation.
        </p>
      </Section>

      <Section heading="Monthly fees">
        <p>
          Monthly fees pay for the month ahead. You may stop future monthly payments at any time; the
          month already paid for runs to its end and is not refunded in part.
        </p>
      </Section>

      <Section heading="Book orders">
        <p>
          A SpeakEdge Book order can be cancelled for a full refund any time before it is dispatched.
          After dispatch, orders are not cancellable, but a book that arrives damaged or incorrect is
          replaced free of charge if you report it within 7 days of delivery with photographs.
        </p>
      </Section>

      <Section heading="Classes and assessments">
        <p>
          Class slots and assessment attempts included in your plan have no separate cash value and are
          not individually refundable. A class cancelled by SpeakEdge is rescheduled or credited back to
          your entitlement.
        </p>
      </Section>

      <Section heading="If we end your membership">
        <p>
          Where membership is suspended or terminated for breach of the{' '}
          <a href="/terms" className="font-medium text-brand hover:underline">Terms &amp; Conditions</a>,{' '}
          <a href="/community-rules" className="font-medium text-brand hover:underline">Speaking Community Rules</a>{' '}
          or{' '}
          <a href="/safety-policy" className="font-medium text-brand hover:underline">Community Safety Policy</a>,
          no refund is payable.
        </p>
      </Section>

      <Section heading="How to request a refund">
        <p>
          WhatsApp us on{' '}
          <a href="https://wa.me/918240861168" className="font-medium text-brand hover:underline">
            82408 61168
          </a>{' '}
          with your order number or student ID and the reason for the request. Approved refunds are
          processed within 7 working days and reach your account according to your bank&apos;s timelines.
          You can follow the status of a refund on the Payments page in your dashboard.
        </p>
      </Section>
    </Doc>
  );
}
