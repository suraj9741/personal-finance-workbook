/**
 * A getByText matcher for text that holds ₹ amounts. Paise sit in their own span, so the plain
 * string matcher can't see "₹1,551.10"; this matches the innermost element whose whole text does.
 */
export const amountText = (want: string | RegExp) => (_: string, el: Element | null) => {
  const hit = (e: Element | null) => {
    const t = (e?.textContent ?? "").replace(/\s+/g, " ").trim();
    return !!e && (typeof want === "string" ? t === want : want.test(t));
  };
  return hit(el) && !Array.from(el?.children ?? []).some(hit);
};
