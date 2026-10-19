const AMOUNT = /(₹[\d,]+)(\.\d{2})/;

/** Text with ₹ amounts in it; each amount's paise go in .amt-frac so they read quieter than the rupees. */
export function Amounts({ children }: { children: string }) {
  const parts = children.split(AMOUNT);
  return <>{parts.map((p, i) => (i % 3 === 2 ? <span key={i} className="amt-frac">{p}</span> : p))}</>;
}
