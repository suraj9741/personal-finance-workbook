const AMOUNT = /(₹[\d,]+)(\.\d{2})/;

/**
 * Text with ₹ amounts in it; each amount's paise go in .amt-frac so they read quieter than the rupees.
 * One wrapping span keeps it a single item where the parent is flex, so no gap opens before the paise.
 */
export function Amounts({ children }: { children: string }) {
  const parts = children.split(AMOUNT);
  return <span>{parts.map((p, i) => (i % 3 === 2 ? <span key={i} className="amt-frac">{p}</span> : p))}</span>;
}
