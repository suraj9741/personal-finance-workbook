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
  /** Shown on the year view's Family cards; ticked per group in Settings. */
  is_family: boolean;
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
  /** Card purchase or refund the bank posted later: decides which statement it lands on. */
  posted_on: string | null;
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
  posted_on?: string | null;
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
/** untracked: before the first entry; partial: holds it, not from the 1st; future: not started. */
export type MonthStatus = "untracked" | "partial" | "tracked" | "future";
export interface YearMonth {
  month: string;
  status: MonthStatus;
  income: string;
  spend: string;
  saved: string;
  invested: string;
  lent: string;
  repaid: string;
  budget: string | null;
}
export interface YearGroup {
  /** null: entries with no category. */
  parent_name: string | null;
  total: string;
  months: string[];
}
export interface YearBudgetRow {
  parent_name: string;
  months: { budget: string | null; actual: string }[];
}
export interface YearExpense {
  id: string;
  date: string;
  description: string | null;
  amount: string;
  parent_name: string | null;
  sub_name: string | null;
  account_name: string | null;
}
export interface YearFamily {
  parent_name: string;
  given: string;
  received: string;
}
export interface YearStats {
  year: number;
  scope: "household" | "me";
  first_entry: string | null;
  income: string;
  spend: string;
  saved: string;
  savings_rate: number | null;
  invested: string;
  lent: string;
  repaid: string;
  budget_to_date: string | null;
  months: YearMonth[];
  groups: YearGroup[];
  budget_grid: YearBudgetRow[];
  biggest: YearExpense[];
  big_count: number;
  big_total: string;
  big_threshold: string;
  family: YearFamily[];
  card_bills_count: number;
  card_bills_total: string;
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
  /** Bank, cash and broker cash: entries dated up to today. */
  balance: string | null;
  /** Bank, cash and broker cash: as the month began and as its last day ends. Null for cards. */
  balance_month_start: string | null;
  balance_month_end: string | null;
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
  /** Card with a statement day: the statement closing in the month (posted dates count). Else null. */
  statement_start: string | null;
  statement_end: string | null;
  statement_purchases: string | null;
  statement_refunds: string | null;
  statement_payments: string | null;
  statement_credits: string | null;
  /** Purchases less refunds since the last statement that closed before today. */
  unbilled_since: string | null;
  unbilled: string | null;
}
export interface Overview {
  month: string;
  totals: {
    bank_balance: string;
    bank_balance_month_start: string;
    bank_balance_month_end: string;
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
    /** For a 422 on one input: the field's name and the message without it. */
    public field?: string,
    public fieldMessage?: string,
  ) {
    super(message);
  }
}

function errorParts(body: unknown, status: number): { message: string; field?: string; fieldMessage?: string } {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return { message: detail };
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { loc?: unknown[]; msg?: string };
    const field = first.loc?.[first.loc.length - 1];
    const msg = first.msg ?? "Invalid input";
    return field ? { message: `${String(field)}: ${msg}`, field: String(field), fieldMessage: msg } : { message: msg };
  }
  return { message: `Request failed (${status})` };
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "fetch",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    // Lets a delete still reach the server when it's sent as the page closes.
    ...(init.keepalive ? { keepalive: true } : {}),
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const { message, field, fieldMessage } = errorParts(body, response.status);
    throw new ApiError(response.status, message, field, fieldMessage);
  }
  return body as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const del = (path: string, keepalive = false) => api<void>(path, { method: "DELETE", keepalive });
