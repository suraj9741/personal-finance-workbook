import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { THEME_PREFS, applyTheme, onThemeChange, readTheme, saveTheme, type ThemePref } from "../theme/theme";

const LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };

function Icon({ pref }: { pref: ThemePref }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;
  if (pref === "system")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" />
      </svg>
    );
  if (pref === "light")
    return (
      <svg {...common} strokeLinecap="round">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
      </svg>
    );
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" />
    </svg>
  );
}

/** Three-way appearance switch: a radio group, so arrows move and Tab enters once. */
export function ThemeSwitch() {
  const [pref, setPref] = useState<ThemePref>(readTheme);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => onThemeChange((next) => {
    setPref(next);
    applyTheme(next);
  }), []);

  function choose(next: ThemePref) {
    setPref(next);
    saveTheme(next);
    applyTheme(next);
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = (THEME_PREFS.indexOf(pref) + step + THEME_PREFS.length) % THEME_PREFS.length;
    choose(THEME_PREFS[index]);
    refs.current[index]?.focus();
  }

  return (
    <span className="segmented compact" role="radiogroup" aria-label="Appearance" onKeyDown={onKeyDown}>
      {THEME_PREFS.map((p, i) => (
        <button
          key={p}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={pref === p}
          aria-label={LABEL[p]}
          title={LABEL[p]}
          tabIndex={pref === p ? 0 : -1}
          className={pref === p ? "active" : undefined}
          onClick={() => choose(p)}
        >
          <Icon pref={p} />
        </button>
      ))}
    </span>
  );
}
