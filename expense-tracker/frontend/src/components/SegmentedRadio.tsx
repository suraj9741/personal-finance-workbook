import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

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
 *
 * One highlight (the thumb) sits behind the buttons and slides to the chosen one. It is placed
 * from the buttons' own boxes, again whenever the control resizes, and only starts moving once
 * it has been placed (data-ready), so a page never opens with it flying in. Until then, or
 * without script, the chosen button paints its own highlight.
 */
export function SegmentedRadio<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "segmented",
  describedBy,
  controls,
}: {
  label: string;
  options: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  describedBy?: string;
  /** The id of what this control changes, for aria-controls. */
  controls?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const track = useRef<HTMLSpanElement>(null);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const place = () => {
      const button = refs.current[selected];
      if (!button) return;
      const y = `${button.offsetTop}px`;
      // Onto another row of a wrapped control: fade in there rather than slide across.
      const jump = "ready" in el.dataset && el.style.getPropertyValue("--thumb-y") !== y;
      delete el.dataset.jump;
      if (jump) {
        void el.offsetWidth; // restart the fade if the last move jumped too
        el.dataset.jump = "";
      }
      el.style.setProperty("--thumb-x", `${button.offsetLeft}px`);
      el.style.setProperty("--thumb-y", y);
      el.style.setProperty("--thumb-w", `${button.offsetWidth}px`);
      el.style.setProperty("--thumb-h", `${button.offsetHeight}px`);
    };
    place();
    const frame = requestAnimationFrame(() => (el.dataset.ready = ""));
    // Late web fonts, a wider window or a wrapping row all move the buttons.
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    resized?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      resized?.disconnect();
    };
  }, [selected, options.length]);

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
    <span ref={track} className={className} role="radiogroup" aria-label={label} aria-describedby={describedBy} aria-controls={controls} onKeyDown={onKeyDown}>
      <span className="segmented-thumb" aria-hidden="true" />
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
          // A text label's bold width is held in reserve (CSS), so picking it doesn't nudge the row.
          data-label={typeof o.label === "string" ? o.label : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
