import { useEffect, useState } from "react";
import { THEME_PREFS, applyTheme, onThemeChange, readTheme, saveTheme, type ThemePref } from "../theme/theme";
import { Icon } from "./Icon";
import { SegmentedRadio } from "./SegmentedRadio";

const LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };

const ICON = { system: "system", light: "sun", dark: "moon" } as const;

/**
 * Three-way appearance switch: a radio group, so arrows move and Tab enters once.
 * The top bar shows icons only; `labelled` (Settings) adds the words. Both stay in step (theme.ts).
 */
export function ThemeSwitch({ labelled = false, describedBy }: { labelled?: boolean; describedBy?: string }) {
  const [pref, setPref] = useState<ThemePref>(readTheme);

  useEffect(() => onThemeChange((next) => {
    setPref(next);
    applyTheme(next);
  }), []);

  function choose(next: ThemePref) {
    setPref(next);
    saveTheme(next);
    applyTheme(next);
  }

  return (
    <SegmentedRadio
      label="Appearance"
      className={labelled ? "segmented labelled" : "segmented compact"}
      describedBy={describedBy}
      value={pref}
      onChange={choose}
      options={THEME_PREFS.map((p) =>
        labelled
          ? { value: p, label: <><Icon name={ICON[p]} /> {LABEL[p]}</> }
          : { value: p, label: <Icon name={ICON[p]} />, name: LABEL[p] },
      )}
    />
  );
}
