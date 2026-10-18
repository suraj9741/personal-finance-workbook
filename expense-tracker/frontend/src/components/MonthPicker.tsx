import { monthLabel, shiftMonth } from "../format";
import { Icon } from "./Icon";

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="month-picker">
      <button type="button" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <Icon name="chevron-left" />
      </button>
      <input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <span className="month-name">{monthLabel(month)}</span>
      <button type="button" aria-label="Next month" onClick={() => onChange(shiftMonth(month, 1))}>
        <Icon name="chevron-right" />
      </button>
    </div>
  );
}
