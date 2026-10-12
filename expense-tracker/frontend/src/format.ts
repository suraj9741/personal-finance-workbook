import type { Account, Category } from "./api";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrExact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

/** ₹1,08,811 (Indian digit grouping). */
export function money(value: string | number | null | undefined, exact = false): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  return (exact ? inrExact : inr).format(n);
}

/** Budget minus spent for an expense, earned minus budget for income: positive is good. */
export function budgetDiff(kind: "expense" | "income", budget: number, actual: number): number {
  return kind === "expense" ? budget - actual : actual - budget;
}

export function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function currentMonth(): string {
  return today().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function categoryLabel(c: Category | undefined): string {
  return c ? `${c.parent_name} › ${c.sub_name}` : "Uncategorized";
}

export const PAY_TYPE_LABEL: Record<string, string> = {
  bank: "Bank",
  credit_card: "Credit card",
  share_broker: "Share broker",
  cash: "Cash",
};

const PAY_TYPE_SHORT: Record<string, string> = {
  bank: "bank",
  credit_card: "card",
  share_broker: "broker",
  cash: "cash",
};

/** "SBI · card" when another account shares the name (SBI bank vs SBI card), else just "SBI". */
export function accountLabel(account: Account | undefined, all: Account[]): string {
  if (!account) return "";
  const key = account.name.toLowerCase();
  const shared = all.some((a) => a.id !== account.id && a.name.toLowerCase() === key);
  return shared ? `${account.name} · ${PAY_TYPE_SHORT[account.pay_type]}` : account.name;
}
