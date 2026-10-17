import type { Transaction } from "./api";

type Entry = Pick<Transaction, "type" | "amount" | "account_id" | "category_id" | "description">;

const entryKey = (t: Entry) => [t.type, Number(t.amount), t.account_id, t.category_id ?? "", t.description.trim().toLowerCase()].join("|");

/**
 * Yesterday's expenses and income that today doesn't have yet. Copies are counted, so two
 * ₹50 coffees yesterday and one today leaves one to repeat, and a second run adds nothing.
 */
export function stillToRepeat<T extends Entry>(yesterday: T[], today: Entry[]): T[] {
  const already = new Map<string, number>();
  for (const t of today) already.set(entryKey(t), (already.get(entryKey(t)) ?? 0) + 1);
  return yesterday.filter((t) => {
    if (t.type !== "expense" && t.type !== "income") return false;
    const left = already.get(entryKey(t)) ?? 0;
    if (left > 0) {
      already.set(entryKey(t), left - 1);
      return false;
    }
    return true;
  });
}
