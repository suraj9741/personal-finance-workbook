import { Icon } from "./Icon";

/** ‹ 2026 ›: the arrows step a year; no year after `max` (the current one). */
export function YearPicker({ year, max, onChange }: { year: number; max: number; onChange: (y: number) => void }) {
  return (
    <div className="month-picker year-picker">
      <button type="button" aria-label="Previous year" onClick={() => onChange(year - 1)}>
        <Icon name="chevron-left" />
      </button>
      <span className="year-name" aria-live="polite">
        {year}
      </span>
      <button type="button" aria-label="Next year" disabled={year >= max} onClick={() => onChange(year + 1)}>
        <Icon name="chevron-right" />
      </button>
    </div>
  );
}
