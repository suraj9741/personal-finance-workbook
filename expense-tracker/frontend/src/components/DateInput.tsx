import { useEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { formatDay, readTypedDay, shiftDay, shiftMonth, today } from "../format";
import { Icon } from "./Icon";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const GAP_PX = 6;
// The calendar's height, near enough: below this much room under the field it opens upwards.
const ROOM_PX = 330;
// The calendar's width, near enough.
const WIDTH_REM = 21;

/** The six Monday-first weeks that show a month, as ISO days. */
function weeksOf(month: string): string[] {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const back = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => shiftDay(first, i - back));
}

const monthTitle = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

interface Placement {
  x: number;
  y: number;
  up: boolean;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min"> & {
  value: string;
  onChange: (iso: string) => void;
  /** Days before this can't be picked from the calendar. */
  min?: string;
};

/**
 * A date you can type or pick: a click anywhere in the field opens a calendar under it, and the
 * cursor stays in the field, so typing "22/10/2026" (or "22102026") still works with it open.
 * The calendar is drawn here rather than the browser's, whose popup takes the keyboard away.
 */
export function DateInput({ value, onChange, min, required, className, onBlur, onClick, onKeyDown, ...rest }: Props) {
  const [text, setText] = useState(formatDay(value));
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [shown, setShown] = useState((value || today()).slice(0, 7));
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const now = today();

  // A new value from outside (Repeat, a reset, an edit opening) shows in the field. While
  // typing, the text runs ahead of the value, so it is left alone when they already agree.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (readTypedDay(text) !== value) setText(formatDay(value));
  }

  function openCalendar() {
    const input = inputRef.current;
    if (!input || placement) return;
    const r = input.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < ROOM_PX && r.top > window.innerHeight - r.bottom;
    // Kept on screen when the field sits near the right edge (a phone has its own rule in CSS).
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const x = Math.max(rem, Math.min(r.left, window.innerWidth - WIDTH_REM * rem - rem));
    setShown((readTypedDay(text) || value || now).slice(0, 7));
    setPlacement({ x, y: up ? r.top - GAP_PX : r.bottom + GAP_PX, up });
  }

  const close = () => setPlacement(null);

  // Scrolling the page or resizing moves the field away from the calendar, so it closes.
  useEffect(() => {
    if (!placement) return;
    const moved = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", close);
    };
  }, [placement]);

  function typed(next: string) {
    setText(next);
    const iso = readTypedDay(next);
    if (iso) {
      onChange(iso);
      setShown(iso.slice(0, 7));
    } else if (!next.trim() && !required) onChange("");
  }

  function pick(iso: string) {
    setText(formatDay(iso));
    onChange(iso);
    close();
  }

  const style = placement
    ? ({ "--pop-x": `${placement.x}px`, "--pop-y": `${placement.y}px` } as CSSProperties)
    : undefined;

  return (
    <span className={["date-input", className].filter(Boolean).join(" ")}>
      <input
        {...rest}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        required={required}
        value={text}
        aria-haspopup="dialog"
        aria-expanded={!!placement}
        onChange={(e) => typed(e.target.value)}
        onClick={(e) => {
          onClick?.(e);
          openCalendar();
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "Escape" && placement) {
            // Without this the Esc would also close a dialog the field sits in.
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            openCalendar();
          } else if (e.key === "Enter" && placement) {
            close();
          }
        }}
        onBlur={(e) => {
          onBlur?.(e);
          close();
          // Tidy what was typed into dd/mm/yyyy; half-typed or not a real day shows the date it still holds.
          const iso = readTypedDay(text);
          if (iso) setText(formatDay(iso));
          else if (text.trim() || required) setText(formatDay(value));
        }}
      />
      <Icon name="calendar" className="date-input-icon" />
      {placement && (
        <div
          ref={popRef}
          className={placement.up ? "date-input-pop up" : "date-input-pop"}
          style={style}
          role="dialog"
          aria-label="Calendar"
          // The cursor stays in the field, so typing keeps working while the calendar is open.
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="date-input-head">
            <span>{monthTitle(shown)}</span>
            <button type="button" tabIndex={-1} aria-label="Previous month" onClick={() => setShown(shiftMonth(shown, -1))}>
              <Icon name="chevron-left" />
            </button>
            <button type="button" tabIndex={-1} aria-label="Next month" onClick={() => setShown(shiftMonth(shown, 1))}>
              <Icon name="chevron-right" />
            </button>
          </div>
          <div className="date-input-grid">
            {WEEKDAYS.map((d) => (
              <span key={d} className="date-input-weekday">
                {d}
              </span>
            ))}
            {weeksOf(shown).map((day) => (
              <button
                key={day}
                type="button"
                tabIndex={-1}
                aria-label={formatDay(day)}
                aria-pressed={day === value}
                aria-current={day === now ? "date" : undefined}
                className={day.startsWith(shown) ? undefined : "other-month"}
                disabled={!!min && day < min}
                onClick={() => pick(day)}
              >
                {Number(day.slice(8))}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
