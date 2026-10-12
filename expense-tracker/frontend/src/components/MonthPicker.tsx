import { monthLabel, shiftMonth } from "../format";

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="month-picker">
      <button type="button" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </button>
      <input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <span className="month-name">{monthLabel(month)}</span>
      <button type="button" aria-label="Next month" onClick={() => onChange(shiftMonth(month, 1))}>
        ›
      </button>
    </div>
  );
}
