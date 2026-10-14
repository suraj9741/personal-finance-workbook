// Thin typed client for /api/v1. Same origin (nginx or the Vite proxy), session cookie auth.

export type Kind = "expense" | "income" | "transfer";
/** Refund takes spend back off an expense category; buy and sell are broker trades. */
export type TxType = Kind | "refund" | "buy" | "sell";
export type StatsGroup = "spend" | "saving" | "lent" | "earned" | "repaid" | "transfer";
export type PayType = "bank" | "credit_card" | "share_broker" | "cash";

export interface Me {
  id: string;
  email: string;
  display_name: string;
  is_site_admin: boolean;
  household_id: string | null;
  household_name: string | null;
  role: "owner" | "member" | null;
}
export interface Category {
  id: string;
  kind: Kind;
  parent_name: string;
  sub_name: string;
  stats_group: StatsGroup;
  is_active: boolean;
  sort_order: number;
}
export interface Account {
  id: string;
  name: string;
  institution: string | null;
  description: string | null;
  pay_type: PayType;
  opening_balance: string;
  opening_date: string | null;
  credit_limit: string | null;
  statement_day: number | null;
  due_day: number | null;
  opening_invested: string;
  current_value: string | null;
  valued_on: string | null;
  visibility: "shared" | "private";
  owner_user_id: string | null;
  is_active: boolean;
}
export interface Transaction {
  id: string;
  date: string;
  amount: string;
  type: TxType;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  description: string;
  cost_basis: string | null;
  counterparty: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
}
export interface TransactionInput {
  date: string;
  amount: string;
  type: TxType;
  account_id: string;
  to_account_id?: string | null;
  category_id?: string | null;
  description: string;
  cost_basis?: string | null;
  counterparty?: string | null;
  notes?: string | null;
}
export interface Rule {
  id: string;
  pattern: string;
  category_id: string;
  priority: number;
  created_by: string | null;
}
export interface Suggestion {
  description: string;
  type: TxType;
  category_id: string | null;
  account_id: string;
  amount: string;
}
export interface CategoryLine {
  category_id: string;
  kind: Kind;
  parent_name: string;
  sub_name: string;
  stats_group: StatsGroup;
  budget: string | null;
  actual: string;
  diff: string;
  over_budget: boolean;
}
export interface MonthStats {
  month: string;
  scope: "household" | "me";
  income: string;
  spend: string;
  saved: string;
  savings_rate: number | null;
  invested: string;
  lent: string;
  repaid: string;
  budget_total: string;
  categories: CategoryLine[];
}
export interface TrendPoint {
  month: string;
  income: string;
  spend: string;
  saved: string;
  savings_rate: number | null;
}
export interface Attention {
  month: string;
  uncategorized: number;
  over_budget: CategoryLine[];
  old_loans: { counterparty: string; outstanding: string; last_lent_on: string }[];
  no_income: boolean;
  credit_card_category_used: number;
}
/** One account's numbers from the server. Fields that don't fit the account's type are null. */
export interface AccountFigures {
  account: Account;
  balance: string | null;
  outstanding: string | null;
  available_credit: string | null;
  next_due_date: string | null;
  invested: string | null;
  deposited: string | null;
  withdrawn: string | null;
  current_value: string | null;
  unrealized_pl: string | null;
  realized_pl: string | null;
  realized_complete: boolean;
  month_income: string;
  month_expenses: string;
  month_refunds: string;
  month_transfers_in: string;
  month_transfers_out: string;
  month_buys: string;
  month_sells: string;
}
export interface Overview {
  month: string;
  totals: {
    bank_balance: string;
    card_outstanding: string;
    available_credit: string | null;
    broker_cash: string;
    invested: string;
    portfolio_value: string | null;
    brokers_valued: number;
    brokers: number;
    month_income: string;
    month_expenses: string;
    net_cash: string;
  };
  accounts: AccountFigures[];
}
export interface Member {
  user_id: string;
  display_name: string;
  email: string;
  role: "owner" | "member";
  is_active: boolean;
}
export interface InviteLink {
  id: string;
  url: string;
  expires_at: string;
  role: string;
  household_name: string | null;
}
export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  is_site_admin: boolean;
  is_active: boolean;
  household_name: string | null;
}
export interface AdminHousehold {
  id: string;
  name: string;
  members: Member[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function errorText(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { loc?: unknown[]; msg?: string };
    const field = first.loc?.[first.loc.length - 1];
    return field ? `${String(field)}: ${first.msg}` : (first.msg ?? "Invalid input");
  }
  return `Request failed (${status})`;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "fetch",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, errorText(body, response.status));
  return body as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const del = (path: string) => api<void>(path, { method: "DELETE" });
