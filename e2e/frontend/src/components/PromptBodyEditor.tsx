import { useEffect, useMemo, useRef, type ClipboardEvent } from 'react';

export type PromptSegment =
  | { kind: 'text'; value: string }
  | { kind: 'placeholder'; key: string };

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

export function parsePromptTemplate(raw: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let last = 0;
  for (const m of raw.matchAll(PLACEHOLDER_RE)) {
    const i = m.index!;
    if (i > last) segments.push({ kind: 'text', value: raw.slice(last, i) });
    segments.push({ kind: 'placeholder', key: m[1] });
    last = i + m[0].length;
  }
  if (last < raw.length) segments.push({ kind: 'text', value: raw.slice(last) });
  if (!segments.length) segments.push({ kind: 'text', value: raw });
  return segments;
}

export function assemblePromptTemplate(segments: PromptSegment[], texts: string[]): string {
  let ti = 0;
  return segments.map((s) => {
    if (s.kind === 'placeholder') return `{{${s.key}}}`;
    return texts[ti++] ?? s.value;
  }).join('');
}

function textParts(raw: string): string[] {
  return parsePromptTemplate(raw)
    .filter((s): s is { kind: 'text'; value: string } => s.kind === 'text')
    .map((s) => s.value);
}

function pastePlain(e: ClipboardEvent) {
  e.preventDefault();
  document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
}

function StaticSpan({
  index,
  text,
  resetKey,
  onChange,
}: {
  index: number;
  text: string;
  resetKey: string;
  onChange: (index: number, value: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerText !== text) ref.current.innerText = text;
  }, [text, resetKey]);

  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="rounded-sm outline-none focus:bg-amber-50/90"
      onInput={() => onChange(index, ref.current?.innerText ?? '')}
      onPaste={pastePlain}
    />
  );
}

/** Read-only rendered prompt — dynamic values highlighted, static text plain. */
export function PromptBodyView({
  raw,
  params,
  className = '',
}: {
  raw: string;
  params: Record<string, string>;
  className?: string;
}) {
  const segments = useMemo(() => parsePromptTemplate(raw), [raw]);

  return (
    <div
      className={`whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700 ${className}`}
      dir="auto"
    >
      {segments.map((seg, i) => {
        if (seg.kind === 'placeholder') {
          const label = params[seg.key] ?? `{{${seg.key}}}`;
          return (
            <span
              key={`p-${i}-${seg.key}`}
              title={`From your profile / lesson — {{${seg.key}}}`}
              className="mx-0.5 inline rounded bg-brand/10 px-1 py-px align-baseline text-brand ring-1 ring-brand/20"
            >
              {label}
            </span>
          );
        }
        return <span key={`t-${i}`}>{seg.value}</span>;
      })}
    </div>
  );
}

/** Rendered prompt with locked dynamic values; only static template text is editable. */
export function PromptBodyEditor({
  value,
  params,
  onChange,
  className = '',
}: {
  value: string;
  params: Record<string, string>;
  onChange: (raw: string) => void;
  className?: string;
}) {
  const segments = useMemo(() => parsePromptTemplate(value), [value]);
  const texts = useMemo(() => textParts(value), [value]);
  let textIndex = 0;

  const updateText = (index: number, next: string) => {
    const parts = [...textParts(value)];
    parts[index] = next;
    onChange(assemblePromptTemplate(segments, parts));
  };

  return (
    <div
      className={`whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700 ${className}`}
      dir="auto"
    >
      {segments.map((seg, i) => {
        if (seg.kind === 'placeholder') {
          const label = params[seg.key] ?? `{{${seg.key}}}`;
          return (
            <span
              key={`p-${i}-${seg.key}`}
              contentEditable={false}
              title={`Dynamic — {{${seg.key}}}`}
              className="mx-0.5 inline rounded bg-brand/10 px-1 py-px align-baseline text-brand ring-1 ring-brand/20 select-none"
            >
              {label}
            </span>
          );
        }
        const idx = textIndex++;
        return (
          <StaticSpan
            key={`t-${i}-${idx}`}
            index={idx}
            text={texts[idx] ?? ''}
            resetKey={value}
            onChange={updateText}
          />
        );
      })}
    </div>
  );
}
