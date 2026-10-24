import { useEffect, useState } from "react";
import type { YearMonth } from "../api";
import { minusMoney, monthLabel } from "../format";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "+12k" / "−4k": the month's saving, short enough to sit under a pair of bars. */
function thousands(value: string): string {
  const n = Math.round(Number(value) / 1000);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}k`;
}

/** Narrow screens draw the chart in fewer units, so its labels stay readable when scaled down. */
function useCompact(): boolean {
  const query = "(max-width: 640px)";
  const [compact, setCompact] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const change = () => setCompact(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return compact;
}

const counted = (m: YearMonth) => m.status === "tracked" || m.status === "partial";

/**
 * Income and spending for each month as pairs of bars, with the month's saving under them.
 * Months before the first entry are hatched ("not tracked"), never drawn as zero. Plain SVG.
 * The scale is at least a month's budget, so a month with a few days of entries stays small.
 */
export function YearChart({ months }: { months: YearMonth[] }) {
  const compact = useCompact();
  const width = compact ? 360 : 760;
  const top = 18;
  const plot = 150;
  const slot = width / 12;
  const bar = Math.min(18, slot * 0.3);
  const values = months.filter(counted).flatMap((m) => [Number(m.income), Number(m.spend)]);
  const budgets = months.map((m) => Number(m.budget ?? 0));
  const max = Math.max(1, ...values, ...budgets);
  const h = (v: number) => (Math.max(v, 0) / max) * (plot - top);
  const ghost = (plot - top) * 0.55;
  return (
    <figure className="year-chart">
      <svg viewBox={`0 0 ${width} ${plot + 44}`} role="img" aria-label="Income and spending for each month">
        <defs>
          <pattern id="year-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
          </pattern>
        </defs>
        <line x1={0} x2={width} y1={plot} y2={plot} className="axis" />
        {months.map((m, i) => {
          const cx = i * slot + slot / 2;
          const shown = counted(m);
          return (
            <g key={m.month}>
              <title>
                {shown
                  ? `${monthLabel(m.month)}: income ${minusMoney(m.income)}, spent ${minusMoney(m.spend)}, saved ${minusMoney(m.saved)}`
                  : `${monthLabel(m.month)}: ${m.status === "future" ? "not started" : "not tracked in the app"}`}
              </title>
              {m.status === "untracked" && <rect x={cx - bar - 2} y={plot - ghost} width={bar * 2 + 4} height={ghost} rx={3} className="untracked" />}
              {m.status === "future" && <rect x={cx - bar - 1} y={plot - 3} width={bar * 2 + 2} height={3} rx={1.5} className="future" />}
              {shown && (
                <>
                  <rect x={cx - bar - 1} width={bar} y={plot - h(Number(m.income))} height={Math.max(h(Number(m.income)), 1)} rx={2} className="inc" />
                  <rect x={cx + 1} width={bar} y={plot - h(Number(m.spend))} height={Math.max(h(Number(m.spend)), 1)} rx={2} className="exp" />
                </>
              )}
              {m.status === "partial" && (
                <text x={cx} y={plot - h(Math.max(Number(m.income), Number(m.spend))) - 6} textAnchor="middle" className="note">
                  part
                </text>
              )}
              <text x={cx} y={plot + 16} textAnchor="middle" className="tick">
                {SHORT[i]}
              </text>
              <text x={cx} y={plot + 34} textAnchor="middle" className={`saved ${shown ? (Number(m.saved) >= 0 ? "pos" : "neg") : "note"}`}>
                {shown ? thousands(m.saved) : m.status === "untracked" ? "—" : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {months
          .filter(counted)
          .map((m) => `${monthLabel(m.month)}: income ${minusMoney(m.income)}, spent ${minusMoney(m.spend)}`)
          .join(". ")}
      </figcaption>
      <ul className="legend" aria-hidden="true">
        <li><span className="swatch inc" /> Income</li>
        <li><span className="swatch exp" /> Spent</li>
        <li><span className="swatch untracked" /> Not tracked in the app</li>
        <li>Under the bars: saved that month</li>
      </ul>
    </figure>
  );
}
