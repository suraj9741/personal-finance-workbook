import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { monthLabel, shiftMonth } from "../format";
import { Icon } from "./Icon";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const monthOf = (year: number, index: number) => `${year}-${String(index + 1).padStart(2, "0")}`;

/**
 * ‹ [October 2026 ⌄] ›: the arrows step a month, and the name opens a year of months to jump to.
 * The month is named once, on the button itself.
 */
export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const [year, chosen] = month.split("-").map(Number);
  const [open, setOpen] = useState(false);
  // The year shown in the grid; its arrows move it without changing the month yet.
  const [shownYear, setShownYear] = useState(year);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  function toggle() {
    setShownYear(year);
    setOpen((o) => !o);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function pick(index: number) {
    onChange(monthOf(shownYear, index));
    close(true);
  }

  // A press outside closes it, as a native menu does.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  // Opening puts focus on the chosen month, so the arrow keys work at once.
  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus();
  }, [open]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // Without this the Esc would also close a dialog the picker sits in.
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key];
    const cells = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = cells.indexOf(document.activeElement as HTMLButtonElement);
    if (step === undefined || at < 0) return;
    e.preventDefault();
    cells[Math.min(Math.max(at + step, 0), cells.length - 1)]?.focus();
  }

  return (
    <div className="month-picker" ref={rootRef}>
      <button type="button" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <Icon name="chevron-left" />
      </button>
      <button
        ref={buttonRef}
        type="button"
        className="month-picker-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Month: ${monthLabel(month)}`}
        onClick={toggle}
      >
        <span className="month-name">{monthLabel(month)}</span>
        <Icon name="chevron-down" className="month-picker-chevron" />
      </button>
      <button type="button" aria-label="Next month" onClick={() => onChange(shiftMonth(month, 1))}>
        <Icon name="chevron-right" />
      </button>
      {open && (
        <div className="month-picker-pop" role="dialog" aria-label="Choose a month" onKeyDown={onKey}>
          <div className="month-picker-year">
            <button type="button" aria-label="Previous year" onClick={() => setShownYear((y) => y - 1)}>
              <Icon name="chevron-left" />
            </button>
            <span aria-live="polite">{shownYear}</span>
            <button type="button" aria-label="Next year" onClick={() => setShownYear((y) => y + 1)}>
              <Icon name="chevron-right" />
            </button>
          </div>
          <div className="month-picker-grid" ref={gridRef}>
            {MONTHS.map((name, index) => (
              <button
                key={name}
                type="button"
                aria-label={`${FULL[index]} ${shownYear}`}
                aria-pressed={shownYear === year && index + 1 === chosen}
                onClick={() => pick(index)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
