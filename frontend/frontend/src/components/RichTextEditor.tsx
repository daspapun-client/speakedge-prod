import { useEffect, useRef, type ClipboardEvent } from 'react';
import {
  Bold,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  RemoveFormatting,
  Underline,
  type LucideIcon,
} from 'lucide-react';

const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H2', 'H3', 'A']);

function escapeText(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain text (existing articles) becomes HTML; already-rich bodies pass through. */
export function toEditorHtml(raw: string): string {
  if (!raw) return '';
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
  return escapeText(raw).replace(/\n/g, '<br>');
}

export function htmlToPlain(html: string): string {
  if (!html) return '';
  if (!/<[a-z][\s\S]*>/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.innerText.replace(/\u00a0/g, ' ');
}

export function isBlankText(text: string): boolean {
  return !text.trim();
}

export function isBlankHtml(html: string): boolean {
  return isBlankText(html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' '));
}

/** Drop scripts/styles/unknown tags; keep basic formatting. Safe for student render. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (parent: Element) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      const style = el.getAttribute('style') || '';
      if (el.tagName === 'SPAN') {
        const wrap =
          /font-weight:\s*(bold|[7-9]00)/i.test(style) ? 'strong'
            : /font-style:\s*italic/i.test(style) ? 'em'
              : /text-decoration:[^;]*underline/i.test(style) ? 'u'
                : null;
        if (wrap) {
          const next = doc.createElement(wrap);
          next.append(...Array.from(el.childNodes));
          el.replaceWith(next);
          walk(next);
          continue;
        }
      }
      if (!ALLOWED.has(el.tagName)) {
        const kids = Array.from(el.childNodes);
        el.replaceWith(...kids);
        kids.forEach((k) => { if (k.nodeType === Node.ELEMENT_NODE) walk(k as Element); });
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const ok = el.tagName === 'A' && attr.name === 'href'
          && /^(https?:|mailto:)/i.test(attr.value.trim());
        if (!ok) el.removeAttribute(attr.name);
      }
      if (el.tagName === 'A') {
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export function displayHtml(raw: string): string {
  return sanitizeHtml(toEditorHtml(raw));
}

function cmd(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function Tool({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon size={15} />
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  lang,
  placeholder = 'Write or paste in any language…',
  plainText = false,
  mono = false,
  minHeight = '12rem',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  lang?: string;
  placeholder?: string;
  /** Store plain text (for AI prompts). Paste still strips Word/Docs junk. */
  plainText?: boolean;
  mono?: boolean;
  minHeight?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fromUser = useRef(false);

  useEffect(() => {
    if (fromUser.current) {
      fromUser.current = false;
      return;
    }
    if (!ref.current) return;
    if (plainText) {
      if (ref.current.innerText !== value) ref.current.innerText = value;
    } else {
      ref.current.innerHTML = toEditorHtml(value);
    }
  }, [value, plainText]);

  const emit = () => {
    if (!ref.current) return;
    fromUser.current = true;
    onChange(plainText ? ref.current.innerText : ref.current.innerHTML);
  };

  const pastePlain = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    emit();
  };

  const pasteRich = (e: ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const cleaned = html ? sanitizeHtml(html) : '';
    const insert = cleaned && !isBlankHtml(cleaned)
      ? cleaned
      : escapeText(text).replace(/\n/g, '<br>');
    cmd('insertHTML', insert);
    emit();
  };

  return (
    <div className={`overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 ${className}`}>
      {!plainText && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-1 py-0.5">
          <Tool icon={Bold} label="Bold" onClick={() => { cmd('bold'); emit(); }} />
          <Tool icon={Italic} label="Italic" onClick={() => { cmd('italic'); emit(); }} />
          <Tool icon={Underline} label="Underline" onClick={() => { cmd('underline'); emit(); }} />
          <Tool icon={Heading2} label="Heading" onClick={() => { cmd('formatBlock', 'h2'); emit(); }} />
          <Tool icon={List} label="Bullet list" onClick={() => { cmd('insertUnorderedList'); emit(); }} />
          <Tool icon={ListOrdered} label="Numbered list" onClick={() => { cmd('insertOrderedList'); emit(); }} />
          <Tool
            icon={LinkIcon}
            label="Link"
            onClick={() => {
              const url = window.prompt('Link URL');
              if (url) cmd('createLink', url);
              emit();
            }}
          />
          <Tool icon={RemoveFormatting} label="Clear formatting" onClick={() => { cmd('removeFormat'); emit(); }} />
        </div>
      )}
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline
        lang={lang}
        dir={lang === 'ur' ? 'rtl' : 'auto'}
        data-placeholder={placeholder}
        style={{ minHeight }}
        className={`rich-text px-3 py-2 outline-none ${plainText ? 'whitespace-pre-wrap text-sm' : 'text-sm'} ${mono ? 'font-mono text-xs leading-relaxed' : ''}`}
        onInput={emit}
        onPaste={plainText ? pastePlain : pasteRich}
      />
    </div>
  );
}
