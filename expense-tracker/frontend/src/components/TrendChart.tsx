import type { TrendPoint } from "../api";
import { money, monthLabel } from "../format";

/** Saved per month as bars (negative months below the line). Plain SVG, no chart library. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const values = points.map((p) => Number(p.saved));
  const max = Math.max(1, ...values.map(Math.abs));
  const width = 600;
  const height = 180;
  const mid = height / 2;
  const slot = width / Math.max(points.length, 1);
  const bar = Math.min(48, slot * 0.6);
  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${width} ${height + 24}`} role="img" aria-label="Money saved per month">
        <line x1={0} x2={width} y1={mid} y2={mid} className="axis" />
        {points.map((p, i) => {
          const v = values[i];
          const h = (Math.abs(v) / max) * (mid - 8);
          const x = i * slot + (slot - bar) / 2;
          return (
            <g key={p.month}>
              <title>{`${monthLabel(p.month)}: saved ${money(p.saved)}`}</title>
              <rect x={x} width={bar} y={v >= 0 ? mid - h : mid} height={Math.max(h, 1)} rx={3} className={v >= 0 ? "pos" : "neg"} />
              <text x={x + bar / 2} y={height + 18} textAnchor="middle" className="tick">
                {monthLabel(p.month).slice(0, 3)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
