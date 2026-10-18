import type { Account, Category, PayType, TxType } from "./api";
import type { IconName } from "./components/Icon";

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

/** "+₹1,800" or "−₹1,800" with a real minus sign (money() prints a hyphen); zero has no sign. */
export function signedMoney(value: string | number, exact = false): string {
  const n = Number(value);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n), exact)}`;
}

/** "+10%" or "−2%" for a change as a share of what it's measured on (0.1 → "+10%"). */
export function signedPercent(ratio: number): string {
  const p = Math.round(ratio * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`;
}

/** "Sept 2026", the short form of monthLabel. */
export function monthShort(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** Account types as short as they go, for filters on a phone. */
export const GROUP_SHORT: Record<AccountGroup, string> = { bank: "Banks", credit_card: "Cards", share_broker: "Brokers" };

export function categoryLabel(c: Category | undefined): string {
  return c ? `${c.parent_name} › ${c.sub_name}` : "Uncategorized";
}

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

/** The three primary account types. Cash lives under Bank. */
export type AccountGroup = "bank" | "credit_card" | "share_broker";
export const ACCOUNT_GROUPS: AccountGroup[] = ["bank", "credit_card", "share_broker"];
export const GROUP_LABEL: Record<AccountGroup, string> = {
  bank: "Bank",
  credit_card: "Credit Card",
  share_broker: "Share Market Broker",
};
export const GROUP_PLURAL: Record<AccountGroup, string> = {
  bank: "Bank accounts",
  credit_card: "Credit cards",
  share_broker: "Share market brokers",
};
export const GROUP_ICON: Record<AccountGroup, IconName> = { bank: "bank", credit_card: "card", share_broker: "chart" };

export function groupOf(payType: PayType): AccountGroup {
  return payType === "cash" ? "bank" : payType;
}

/** One account's icon: its group's, except cash, which gets the rupee sign. */
export const accountIcon = (payType: PayType): IconName => (payType === "cash" ? "rupee" : GROUP_ICON[groupOf(payType)]);

export const TX_TYPE_LABEL: Record<TxType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  refund: "Refund",
  buy: "Buy",
  sell: "Sell",
};

/** Money into the account the row is on ("+"), out of it ("−"), or a transfer (no sign). */
export function txSign(type: TxType): string {
  if (type === "income" || type === "refund" || type === "sell") return "+";
  if (type === "transfer") return "";
  return "−";
}

/** The category kind a transaction type takes; null when it takes none (buy, sell). */
export function categoryKind(type: TxType): "expense" | "income" | "transfer" | null {
  if (type === "refund") return "expense";
  if (type === "buy" || type === "sell") return null;
  return type;
}

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "17 Oct", or "17 Oct 2025" outside the current year. */
export function dayLabel(iso: string, now: string = today()): string {
  const sameYear = iso.slice(0, 4) === now.slice(0, 4);
  return parseDay(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Today", "Yesterday", or "Fri, 17 Oct" (with the year outside the current one). */
export function dayHeading(iso: string, now: string = today()): string {
  const diff = Math.round((parseDay(now).getTime() - parseDay(iso).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const weekday = parseDay(iso).toLocaleDateString("en-IN", { weekday: "short" });
  return `${weekday}, ${dayLabel(iso, now)}`;
}

/** A day's money: spent is expenses less refunds, earned is income. Transfers, buys and sells don't count. */
export function dayTotals(rows: { type: TxType; amount: string }[]): { spent: number; earned: number; net: number } {
  let spent = 0;
  let earned = 0;
  for (const r of rows) {
    const n = Number(r.amount);
    if (r.type === "expense") spent += n;
    else if (r.type === "refund") spent -= n;
    else if (r.type === "income") earned += n;
  }
  return { spent, earned, net: earned - spent };
}

/** The ISO date `delta` days from `iso`. */
export function shiftDay(iso: string, delta: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** money() with a real minus sign, so a negative reads −₹5,000 rather than -₹5,000. */
export function minusMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return n < 0 ? `−${money(-n)}` : money(n);
}

/**
 * Budgets split the way /stats/month counts money: spending budgets (compared with "spent")
 * and planned savings (PPF, shares…), which "spent" leaves out. budget_total mixes the two.
 */
export function budgetSplit(lines: { kind: string; stats_group: string; budget: string | null }[]): { spend: number; saving: number } {
  let spend = 0;
  let saving = 0;
  for (const line of lines) {
    if (line.kind !== "expense" || !line.budget) continue;
    if (line.stats_group === "spend") spend += Number(line.budget);
    else if (line.stats_group === "saving") saving += Number(line.budget);
  }
  return { spend, saving };
}

/** A budget bar's state: under budget (""), close to it from 90% ("warn"), or past it ("over"). */
export function budgetTone(actual: number, budget: number): "" | "warn" | "over" {
  if (budget <= 0) return "";
  if (actual > budget) return "over";
  return actual >= budget * 0.9 ? "warn" : "";
}
