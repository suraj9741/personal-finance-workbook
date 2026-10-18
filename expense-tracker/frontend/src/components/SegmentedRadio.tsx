import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  /** The spoken name (and tooltip) when the label is only an icon. */
  name?: string;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A segmented control that is one radio group: Tab enters once, on the chosen segment,
 * and the arrow keys (or Home/End) move the choice. The look stays neutral grey (.segmented).
 */
export function SegmentedRadio<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "segmented",
  describedBy,
}: {
  label: string;
  options: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  describedBy?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));

  function move(index: number) {
    onChange(options[index].value);
    refs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    const last = options.length - 1;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      return move(event.key === "Home" ? 0 : last);
    }
    const step = STEP[event.key];
    if (!step) return;
    event.preventDefault();
    move((selected + step + options.length) % options.length);
  }

  return (
    <span className={className} role="radiogroup" aria-label={label} aria-describedby={describedBy} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.name}
          title={o.name}
          tabIndex={i === selected ? 0 : -1}
          className={o.value === value ? "active" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
