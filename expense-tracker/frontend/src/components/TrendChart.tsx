import type { TrendPoint } from "../api";
import { monthLabel, minusMoney } from "../format";

/**
 * Saved per month as bars (negative months below the line). Plain SVG, no chart library.
 * The per-bar <title>s can't be reached inside role="img", so a hidden caption lists every month.
 */
export function TrendChart({ points, label = "Money saved per month" }: { points: TrendPoint[]; label?: string }) {
  const values = points.map((p) => Number(p.saved));
  const max = Math.max(1, ...values.map(Math.abs));
  // Narrow enough that the month labels stay readable in a half-width card or on a phone.
  const width = 360;
  const height = 180;
  const mid = height / 2;
  const slot = width / Math.max(points.length, 1);
  const bar = Math.min(48, slot * 0.6);
  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${width} ${height + 24}`} role="img" aria-label={label}>
        <line x1={0} x2={width} y1={mid} y2={mid} className="axis" />
        {points.map((p, i) => {
          const v = values[i];
          const h = (Math.abs(v) / max) * (mid - 8);
          const x = i * slot + (slot - bar) / 2;
          return (
            <g key={p.month}>
              <title>{`${monthLabel(p.month)}: saved ${minusMoney(p.saved)}`}</title>
              <rect x={x} width={bar} y={v >= 0 ? mid - h : mid} height={Math.max(h, 1)} rx={3} className={v >= 0 ? "pos" : "neg"} />
              <text x={x + bar / 2} y={height + 18} textAnchor="middle" className="tick">
                {monthLabel(p.month).slice(0, 3)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {points.map((p) => `${monthLabel(p.month)}: saved ${minusMoney(p.saved)}`).join(". ")}
      </figcaption>
    </figure>
  );
}
