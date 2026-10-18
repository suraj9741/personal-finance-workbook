// The app's icons: outline drawings on a 24-unit grid with round ends, in the text colour and
// 1em square so they grow with the words beside them. Drawn here in the spirit of SF Symbols
// (whose licence keeps them to Apple platforms), so there is no icon library to load.
const PATHS = {
  bank: "M3 10h18M12 3l9 5H3zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18",
  card: "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3 10h18M7 15h4",
  chart: "M3 17l6-6 4 4 8-8M15 7h6v6",
  "chevron-left": "M15 5l-7 7 7 7",
  "chevron-right": "M9 5l7 7-7 7",
  "chevron-down": "M6 9l6 6 6-6",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7",
  "arrow-right": "M4 12h16M14 6l6 6-6 6",
  sun: "M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  system: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z",
} as const;

export type IconName = keyof typeof PATHS;

/**
 * An icon beside words is decoration, so screen readers skip it. Give `label` only when the
 * icon is all there is (a ✕-only button would rather carry its own aria-label).
 */
export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
      {/* System: the circle's right half filled, for "follows the device". */}
      {name === "system" && <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />}
    </svg>
  );
}
