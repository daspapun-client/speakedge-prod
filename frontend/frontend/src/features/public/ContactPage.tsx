/**
 * Public Contact page (`/contact`) — the target of the "Contact" link in the
 * navigation and the footer. Every detail comes from `lib/site.ts`, so the
 * footer and this page can never drift apart.
 */
import { Clock, Mail, MapPin, MessageCircle } from 'lucide-react';
import {
  CONTACT_PHONE, OFFICE_ADDRESS, SUPPORT_EMAIL, SUPPORT_EMAIL_URL, SUPPORT_HOURS, WHATSAPP_URL,
} from '@/lib/site';

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Icon size={18} />
      </span>
      <div className="text-sm">
        <div className="font-semibold text-slate-900">{label}</div>
        <div className="mt-1 space-y-0.5 text-slate-600">{children}</div>
      </div>
    </div>
  );
}

export function ContactPage() {
  return (
    <div id="contact" className="max-w-3xl scroll-mt-28">
      <h1 className="text-3xl font-extrabold text-slate-900">Contact SpeakEdge</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Have a question about SpeakEdge membership, book orders, activation, payments, classes or
        assessments? Our support team is here to help.
      </p>
      <p className="mt-3 text-sm font-medium text-slate-500">
        SpeakEdge — A Product of Sujyoti EdTech Pvt. Ltd.
      </p>

      <div className="card mt-6 grid gap-6 p-6 sm:grid-cols-2">
        <Row icon={MessageCircle} label="WhatsApp / Mobile">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand hover:underline"
          >
            {CONTACT_PHONE}
          </a>
        </Row>

        <Row icon={Mail} label="Email">
          <a href={SUPPORT_EMAIL_URL} className="font-medium text-brand hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </Row>

        <Row icon={MapPin} label="Office">
          {OFFICE_ADDRESS.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </Row>

        <Row icon={Clock} label="Support Hours">
          <div>{SUPPORT_HOURS}</div>
        </Row>
      </div>
    </div>
  );
}
