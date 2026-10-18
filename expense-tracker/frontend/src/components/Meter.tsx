import type { CSSProperties } from "react";

export type MeterTone = "neutral" | "warn" | "over" | "income";

/**
 * A thin bar of how much is used: spent against budget, or owed against a card's limit.
 * It only repeats what the words beside it say, so screen readers skip it.
 * Without a tone it follows the spending rule: grey under 90%, orange from 90%, red when over.
 */
export function Meter({ ratio, tone, size }: { ratio: number; tone?: MeterTone; size?: "lg" }) {
  const shown = tone ?? (ratio > 1 ? "over" : ratio >= 0.9 ? "warn" : "neutral");
  const value = Math.min(Math.max(ratio, 0), 1);
  return (
    <span className={size === "lg" ? "meter meter-lg" : "meter"} aria-hidden="true">
      <span className={`meter-fill ${shown}`} style={{ "--meter-value": value } as CSSProperties} />
    </span>
  );
}
