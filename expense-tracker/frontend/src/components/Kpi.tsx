import { Amounts } from "./Amounts";

export function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "bad" }) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        <Amounts>{value}</Amounts>
      </span>
      {note && (
        <span className="kpi-note">
          <Amounts>{note}</Amounts>
        </span>
      )}
    </div>
  );
}
