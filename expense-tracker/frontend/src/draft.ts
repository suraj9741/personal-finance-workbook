import { useEffect, useState } from "react";

// Popup forms keep what you typed per tab, like a Mail draft: closing never asks and never loses it.
const PREFIX = "et:draft:";

interface Stored {
  /** The form as it opened, so a draft of an edit can tell the entry changed since. */
  base: string;
  value: string;
}

function read(key: string): Stored | null {
  try {
    return JSON.parse(sessionStorage.getItem(PREFIX + key) ?? "null") as Stored | null;
  } catch {
    return null;
  }
}

export function forgetDraft(key: string) {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable: nothing was kept */
  }
}

/**
 * The draft left under `key`, if any, and the form as it opened (`base`). With `strict`, a draft
 * whose base no longer matches is dropped: the saved entry changed after it was typed.
 */
export function useDraft<T>(key: string, blank: T, strict: boolean) {
  const [base] = useState(() => JSON.stringify(blank));
  const [restored] = useState<T | null>(() => {
    const stored = read(key);
    if (!stored || (strict && stored.base !== base)) return null;
    try {
      return JSON.parse(stored.value) as T;
    } catch {
      return null;
    }
  });
  return { base, restored };
}

/** Keeps `value` under `key` while it differs from `base`, and forgets it once they match again. */
export function useKeepDraft(key: string, base: string, value: unknown) {
  const json = JSON.stringify(value);
  useEffect(() => {
    if (json === base) return forgetDraft(key);
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify({ base, value: json } satisfies Stored));
    } catch {
      /* storage unavailable: the draft lasts until the popup closes */
    }
  }, [key, base, json]);
}
