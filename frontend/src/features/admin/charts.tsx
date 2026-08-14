import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

/** Categorical palette — brand tokens first, then accents. */
export const CHART_COLORS = ['#00529B', '#2F80ED', '#F4B400', '#10B981', '#8B5CF6', '#EC4899', '#F97316', '#14B8A6'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-07' → "Jul '26". */
export function shortMonth(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS[+m - 1] ?? m} '${y.slice(2)}`;
}

/** Card shell with a title used to frame each chart. */
export function ChartCard({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          {hint && <p className="text-xs text-slate-400">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function sparkPath(values: number[], w: number, h: number, pad = 3) {
  if (!values.length) return { line: '', area: '' };
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  return { line, area };
}

/** Big current value + month-over-month delta + area sparkline for one metric. */
export function TrendCard({
  title,
  values,
  labels,
  color = '#00529B',
  format = (n: number) => n.toLocaleString('en-IN'),
}: {
  title: string;
  values: number[];
  labels: string[];
  color?: string;
  format?: (n: number) => string;
}) {
  const id = useId();
  const w = 320;
  const h = 56;
  const { line, area } = sparkPath(values, w, h);
  const last = values[values.length - 1] ?? 0;
  const prev = values.length > 1 ? values[values.length - 2] : 0;
  const delta = prev ? Math.round(((last - prev) / prev) * 100) : null;
  const up = delta != null && delta >= 0;

  return (
    <div className="card">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-extrabold text-brand">{format(last)}</span>
        {delta != null && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
            {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-3 h-14 w-full" role="img" aria-label={`${title} trend`}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#g${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{labels.length ? shortMonth(labels[0]) : ''}</span>
        <span>{labels.length ? shortMonth(labels[labels.length - 1]) : ''}</span>
      </div>
    </div>
  );
}

/** Horizontal ranked bars — serves distributions and leaderboards alike. */
export function BarList({
  items,
  format = (n: number) => n.toLocaleString('en-IN'),
  color,
  empty = 'No data yet.',
}: {
  items: { label: string; value: number; hint?: string }[];
  format?: (n: number) => string;
  color?: string;
  empty?: string;
}) {
  if (!items.length) return <p className="py-4 text-center text-sm text-slate-400">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={`${it.label}-${i}`}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate capitalize text-slate-700">{it.label || '—'}</span>
            <span className="shrink-0 font-semibold text-slate-900">
              {format(it.value)}
              {it.hint && <span className="ml-1 text-xs font-normal text-slate-400">{it.hint}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full transition-all"
              style={{ width: `${Math.max(4, (it.value / max) * 100)}%`, background: color ?? CHART_COLORS[i % CHART_COLORS.length] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 *  Cartesian charts — line & bar. Hand-rolled SVG, width-measured so   *
 *  hover tooltips map exactly to pixels. One y-axis only (never dual). *
 * ------------------------------------------------------------------ */

export interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Round a max up to a clean axis bound (1/2/5 × 10ⁿ). */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** Measure a container's width via ResizeObserver for pixel-accurate charts. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const PAD = { top: 14, right: 16, bottom: 26, left: 48 };

function ChartTip({ x, left, children }: { x: number; left: boolean; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 -translate-y-0 whitespace-nowrap rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur"
      style={{ left: x, transform: left ? 'translateX(-100%) translateX(-10px)' : 'translateX(10px)' }}
    >
      {children}
    </div>
  );
}

/** Multi-series line chart with gridlines, axis labels, and a hover crosshair. */
export function LineChart({
  series,
  labels,
  format = (n: number) => n.toLocaleString('en-IN'),
  height = 220,
}: {
  series: Series[];
  labels: string[];
  format?: (n: number) => string;
  height?: number;
}) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const innerW = Math.max(0, w - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const rawMax = Math.max(1, ...series.flatMap((s) => s.values));
  const max = niceCeil(rawMax);
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - rect.left - PAD.left) / innerW) * (n - 1));
            setHover(Math.max(0, Math.min(n - 1, i)));
          }}
        >
          {ticks.map((t) => {
            const gy = PAD.top + innerH - t * innerH;
            return (
              <g key={t}>
                <line x1={PAD.left} y1={gy} x2={w - PAD.right} y2={gy} stroke="#f1f5f9" strokeWidth={1} />
                <text x={PAD.left - 8} y={gy + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                  {format(Math.round(max * t))}
                </text>
              </g>
            );
          })}
          {labels.map((l, i) =>
            n <= 8 || i % 2 === 0 ? (
              <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
                {shortMonth(l)}
              </text>
            ) : null,
          )}
          {hover != null && (
            <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={PAD.top + innerH} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {series.map((s) => (
            <path
              key={s.name}
              d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hover != null &&
            series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill="#fff" stroke={s.color} strokeWidth={2} />
            ))}
        </svg>
      )}
      {hover != null && (
        <ChartTip x={x(hover)} left={x(hover) > w / 2}>
          <div className="mb-1 font-semibold text-slate-700">{shortMonth(labels[hover])}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-slate-500">{s.name}</span>
              <span className="ml-auto font-semibold text-slate-800">{format(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </ChartTip>
      )}
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap justify-center gap-4">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Single-series vertical bar chart with gridlines and a per-bar hover tooltip. */
export function BarChart({
  labels,
  values,
  color = CHART_COLORS[2],
  format = (n: number) => n.toLocaleString('en-IN'),
  height = 220,
}: {
  labels: string[];
  values: number[];
  color?: string;
  format?: (n: number) => string;
  height?: number;
}) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const innerW = Math.max(0, w - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const max = niceCeil(Math.max(1, ...values));
  const slot = n ? innerW / n : innerW;
  const bw = Math.min(46, slot * 0.62);
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const barH = (v: number) => (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg width={w} height={height} role="img" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => {
            const gy = PAD.top + innerH - t * innerH;
            return (
              <g key={t}>
                <line x1={PAD.left} y1={gy} x2={w - PAD.right} y2={gy} stroke="#f1f5f9" strokeWidth={1} />
                <text x={PAD.left - 8} y={gy + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                  {format(Math.round(max * t))}
                </text>
              </g>
            );
          })}
          {values.map((v, i) => {
            const h = barH(v);
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect
                  x={cx(i) - bw / 2}
                  y={PAD.top + innerH - h}
                  width={bw}
                  height={Math.max(h, v > 0 ? 2 : 0)}
                  rx={4}
                  fill={color}
                  opacity={hover == null || hover === i ? 1 : 0.4}
                  className="transition-opacity"
                />
                {(n <= 8 || i % 2 === 0) && (
                  <text x={cx(i)} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
                    {shortMonth(labels[i])}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && (
        <ChartTip x={cx(hover)} left={cx(hover) > w / 2}>
          <div className="font-semibold text-slate-700">{shortMonth(labels[hover])}</div>
          <div className="mt-0.5 font-semibold" style={{ color }}>
            {format(values[hover] ?? 0)}
          </div>
        </ChartTip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Donut chart — composition / parts-of-a-whole, with a legend.       *
 * ------------------------------------------------------------------ */

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function donutSeg(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number): string {
  const [sx, sy] = polar(cx, cy, rO, a1);
  const [ex, ey] = polar(cx, cy, rO, a0);
  const [isx, isy] = polar(cx, cy, rI, a0);
  const [iex, iey] = polar(cx, cy, rI, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${sx} ${sy} A${rO} ${rO} 0 ${large} 0 ${ex} ${ey} L${isx} ${isy} A${rI} ${rI} 0 ${large} 1 ${iex} ${iey} Z`;
}

/** Donut/pie for distributions; center shows the total, legend lists shares. */
export function DonutChart({
  items,
  format = (n: number) => n.toLocaleString('en-IN'),
  empty = 'No data yet.',
  size = 168,
}: {
  items: { label: string; value: number }[];
  format?: (n: number) => string;
  empty?: string;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const data = items.filter((i) => i.value > 0);
  const total = data.reduce((s, i) => s + i.value, 0);
  if (!total) return <p className="py-8 text-center text-sm text-slate-400">{empty}</p>;

  const cx = size / 2;
  const cy = size / 2;
  const rO = size / 2 - 4;
  const rI = rO * 0.62;
  let acc = 0;
  const segs = data.map((it, i) => {
    const a0 = (acc / total) * 360;
    acc += it.value;
    const a1 = (acc / total) * 360;
    return { ...it, a0, a1, color: CHART_COLORS[i % CHART_COLORS.length], pct: (it.value / total) * 100 };
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <svg width={size} height={size} role="img" className="shrink-0">
        {segs.map((s, i) =>
          s.a1 - s.a0 >= 359.999 ? (
            <circle key={i} cx={cx} cy={cy} r={(rO + rI) / 2} fill="none" stroke={s.color} strokeWidth={rO - rI} />
          ) : (
            <path
              key={i}
              d={donutSeg(cx, cy, rO, rI, s.a0, s.a1)}
              fill={s.color}
              stroke="#fff"
              strokeWidth={2}
              opacity={hover == null || hover === i ? 1 : 0.45}
              className="cursor-default transition-opacity"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ),
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-slate-900 text-lg font-extrabold">
          {hover != null ? `${segs[hover].pct.toFixed(0)}%` : format(total)}
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" className="fill-slate-400 text-[10px]">
          {hover != null ? segs[hover].label : 'Total'}
        </text>
      </svg>
      <ul className="min-w-[8rem] flex-1 space-y-1.5">
        {segs.map((s, i) => (
          <li
            key={i}
            className={`flex items-center gap-2 text-sm transition-opacity ${hover != null && hover !== i ? 'opacity-45' : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="truncate capitalize text-slate-600">{s.label || '—'}</span>
            <span className="ml-auto shrink-0 font-semibold text-slate-800">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
