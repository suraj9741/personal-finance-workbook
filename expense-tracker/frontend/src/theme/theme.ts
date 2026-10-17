/** System / Light / Dark, saved per browser. index.html applies the saved choice before first paint. */
export type ThemePref = "system" | "light" | "dark";

export const THEME_KEY = "et:theme";
export const THEME_PREFS: ThemePref[] = ["system", "light", "dark"];

export function readTheme(): ThemePref {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
}

// The browser bar colour comes from the two theme-color metas in index.html; keep their
// original values so a forced theme can point both at the light or the dark one.
const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
const scheme = (meta: HTMLMetaElement) => ((meta.getAttribute("media") ?? "").includes("dark") ? "dark" : "light");

/** data-theme on <html> sets color-scheme, which flips every light-dark() token. */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;

  const all = metas();
  for (const meta of all) meta.dataset.color ??= meta.content;
  const colourFor = (s: string) => all.find((m) => scheme(m) === s)?.dataset.color ?? "";
  for (const meta of all) meta.content = pref === "system" ? meta.dataset.color! : colourFor(pref);
}

/** Follow a choice made in another open tab. */
export function onThemeChange(listener: (pref: ThemePref) => void): () => void {
  const handle = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) listener(readTheme());
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}
