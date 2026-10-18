import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, type Account, type AccountFigures, type Transaction } from "../api";
import { AccountForm } from "../components/AccountForm";
import { Meter } from "../components/Meter";
import { Modal } from "../components/Modal";
import { useToasts } from "../components/toast-context";
import { MonthPicker } from "../components/MonthPicker";
import { TransactionForm } from "../components/TransactionForm";
import {
  GROUP_ICON,
  GROUP_LABEL,
  GROUP_PLURAL,
  TX_TYPE_LABEL,
  accountLabel,
  categoryLabel,
  currentMonth,
  dayHeading,
  dayLabel,
  groupOf,
  money,
  monthLabel,
  signedMoney,
  signedPercent,
  today,
  type AccountGroup,
} from "../format";
import { useAccounts, useCategories, useMe } from "../hooks";

const PAGE = 100;
const NO_FILTERS = { type: "", category_id: "" };

/** Rows in date order, split into one group per day (as on the Transactions page). */
function byDay(items: Transaction[]): [string, Transaction[]][] {
  const groups = new Map<string, Transaction[]>();
  for (const t of items) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  return [...groups];
}

/** "1st", "2nd", "23rd", "5th". */
function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "today", "tomorrow", "in 18 days", or "3 days ago". */
function fromToday(iso: string): string {
  const day = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const days = Math.round((day(iso) - day(today())) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return days > 0 ? `in ${days} days` : `${-days} ${days === -1 ? "day" : "days"} ago`;
}

/** "Credit card" from "Credit Card": the type as it reads in a sentence. */
const typeName = (account: Account, group: AccountGroup) =>
  account.pay_type === "cash" ? "Cash" : GROUP_LABEL[group].charAt(0) + GROUP_LABEL[group].slice(1).toLowerCase();

/** One account: its figures, its month, and the entries on it. */
export function AccountDetails() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? currentMonth();
  // The month picker also filters the entries, unless "All dates" is chosen.
  const allDates = params.get("dates") === "all";
  const me = useMe().data;
  const accounts = useAccounts(true).data ?? [];
  const categories = useCategories(true).data ?? [];
  const [filters, setFilters] = useState(NO_FILTERS);
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<"account" | "value" | "new" | Transaction | null>(null);
  const { hidden } = useToasts();
  const navigate = useNavigate();

  const summary = useQuery({
    queryKey: ["account-summary", id, month],
    queryFn: () => api<AccountFigures>(`/accounts/${id}/summary?month=${month}`),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
    // A new month keeps the page on screen while its figures load.
    placeholderData: keepPreviousData,
  });
  const query = new URLSearchParams({ account_id: id, limit: String(limit) });
  if (!allDates) query.set("month", month);
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  // Keep the old rows on screen while a new month or filter loads.
  const list = useQuery({
    queryKey: ["transactions", "account", query.toString()],
    queryFn: () => api<{ items: Transaction[]; total: number }>(`/transactions?${query}`),
    placeholderData: keepPreviousData,
  });

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
    setLimit(PAGE);
  }
  // Picking a month means "show me that month", so it also leaves All dates.
  function setMonth(m: string) {
    const next = new URLSearchParams(params);
    next.set("month", m);
    next.delete("dates");
    setParams(next, { replace: true });
    setLimit(PAGE);
  }
  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setLimit(PAGE);
  };
  function clearFilters() {
    setFilters(NO_FILTERS);
    setParam("dates", "");
  }

  if (summary.isPending)
    return (
      <section className="account-details" aria-busy="true" aria-label="Loading account">
        <div className="acct-skeleton" aria-hidden="true">
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      </section>
    );
  if (summary.isError) {
    const missing = summary.error instanceof ApiError && summary.error.status === 404;
    return (
      <section className="account-details">
        <div className="card account-state">
          <p>{missing ? "This account doesn't exist or isn't shared with you." : `Couldn't load this account: ${summary.error.message}`}</p>
          <div className="row wrap">
            {!missing && (
              <button type="button" onClick={() => summary.refetch()}>
                Try again
              </button>
            )}
            <button type="button" className="tinted" onClick={() => navigate("/accounts")}>
              Back to accounts
            </button>
          </div>
        </div>
      </section>
    );
  }
  const s = summary.data;
  const account = s.account;
  const group = groupOf(account.pay_type);
  const canManage = account.visibility === "private" ? account.owner_user_id === me?.id : me?.role === "owner";
  const loaded = list.data?.items ?? [];
  const items = loaded.filter((t) => !hidden.has(t.id));
  const total = (list.data?.total ?? 0) - (loaded.length - items.length);
  const more = total - items.length;
  const days = byDay(items);
  const filtered = allDates || Object.values(filters).some(Boolean);
  const subtitle = [typeName(account, group), account.institution, account.opening_date && `opened ${dayLabel(account.opening_date)}`].filter(Boolean).join(" · ");
  // Seen from this account: money in is +, money out is −. Transfers stay grey either way.
  const sign = (t: Transaction) =>
    t.type === "transfer" ? (t.to_account_id === account.id ? "+" : "−") : ["income", "refund", "sell"].includes(t.type) ? "+" : "−";
  const otherName = (otherId: string | null) => accountLabel(accounts.find((a) => a.id === otherId), accounts);

  return (
    <section className="account-details">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol>
          <li>
            <Link to="/accounts">Accounts</Link>
          </li>
          <li>
            <Link to={`/accounts?type=${group}`}>{GROUP_PLURAL[group]}</Link>
          </li>
        </ol>
      </nav>
      <div className="detail-head">
        <div className="detail-title">
          <span className="detail-icon" aria-hidden="true">
            {GROUP_ICON[group]}
          </span>
          <div>
            <div className="detail-name">
              <h1>{account.name}</h1>
              {!account.is_active && <span className="tag">Inactive</span>}
              {account.visibility === "private" && <span className="tag">Private</span>}
            </div>
            <p className="muted small">{subtitle}</p>
            {account.description && <p className="small">{account.description}</p>}
          </div>
        </div>
        <div className="detail-actions">
          {account.is_active && (
            <button type="button" className="primary" data-return-focus onClick={() => setEditing("new")}>
              Add transaction
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => setEditing("account")}>
              Edit account
            </button>
          )}
        </div>
      </div>
      {!account.is_active && (
        <p className="notice">
          This account is inactive, so it's left out of pickers and totals.{canManage && " Edit account to activate it."}
        </p>
      )}

      <div className="card acct-summary">
        <Hero s={s} group={group} onUpdateValue={canManage ? () => setEditing("value") : undefined} />
        <Facts s={s} group={group} />
      </div>

      <div className="toolbar acct-month-head">
        <h2 className="section-title">{month === currentMonth() ? "This month" : "Month"}</h2>
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      <MonthFigures s={s} group={group} />

      <h2 className="section-title">Entries</h2>
      <div className="filters">
        <select aria-label="Dates" value={allDates ? "all" : "month"} onChange={(e) => setParam("dates", e.target.value === "all" ? "all" : "")}>
          <option value="month">{monthLabel(month)}</option>
          <option value="all">All dates</option>
        </select>
        <select aria-label="Type" value={filters.type} onChange={(e) => setFilter("type", e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TX_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Category filter" value={filters.category_id} onChange={(e) => setFilter("category_id", e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parent_name} › {c.sub_name}
            </option>
          ))}
        </select>
        {filtered && (
          <button type="button" className="ghost" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>
      <p className="muted small" aria-live="polite">
        {list.data ? `${total} ${total === 1 ? "entry" : "entries"}${allDates ? "" : ` in ${monthLabel(month)}`}` : list.isError ? "" : "Loading…"}
        {list.isFetching && list.data && " · Updating…"}
      </p>
      <div className="table-wrap">
        {list.isError && !list.data ? (
          <div className="table-state">
            <p>Couldn't load entries.</p>
            <button type="button" onClick={() => list.refetch()}>
              Try again
            </button>
          </div>
        ) : list.data && items.length === 0 ? (
          <div className="table-state">
            {Object.values(filters).some(Boolean) ? (
              <>
                <p>No entries match these filters.</p>
                <button type="button" className="ghost" onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p>{allDates ? "No entries on this account yet." : `No entries in ${monthLabel(month)}.`}</p>
                {account.is_active && (
                  <button type="button" className="tinted" onClick={() => setEditing("new")}>
                    Add transaction
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <table className="tx-table acct-entries">
            <caption className="sr-only">
              Entries on {account.name}
              {allDates ? "" : ` in ${monthLabel(month)}`}
            </caption>
            <thead>
              <tr>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {!list.data && (
              <tbody aria-hidden="true">
                {Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="skeleton-row">
                    {Array.from({ length: 4 }, (_, j) => (
                      <td key={j}>
                        <span className="skeleton" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
            {days.map(([date, dayRows]) => (
              <tbody key={date}>
                <tr className="day-head">
                  <th scope="row" colSpan={4}>
                    {dayHeading(date)}
                  </th>
                </tr>
                {dayRows.map((t) => {
                  const inbound = t.to_account_id === account.id;
                  const otherId = t.type === "transfer" ? (inbound ? t.account_id : t.to_account_id) : null;
                  const other = otherName(otherId);
                  return (
                    <tr key={t.id} className={t.type}>
                      <td>
                        {t.description || <span className="muted">(no description)</span>}
                        {otherId && (
                          <small className="muted">
                            {" "}
                            {inbound ? "from" : "to"} {other ? <Link to={`/accounts/${otherId}`}>{other}</Link> : "another account"}
                          </small>
                        )}
                        {t.counterparty && <small className="muted"> · {t.counterparty}</small>}
                      </td>
                      <td>
                        {t.type === "transfer" || t.type === "buy" || t.type === "sell" ? (
                          <span className="muted">{TX_TYPE_LABEL[t.type]}</span>
                        ) : (
                          <span className="cat-cell">
                            {t.category_id ? categoryLabel(categories.find((c) => c.id === t.category_id)) : <span className="muted">Uncategorized</span>}
                            {t.type === "refund" && <small className="tag">refund</small>}
                          </span>
                        )}
                      </td>
                      <td className={`num ${t.type}`}>
                        {sign(t)}
                        {money(t.amount, true)}
                      </td>
                      <td className="actions">
                        <button
                          type="button"
                          className="ghost small"
                          aria-label={`Edit ${t.description || TX_TYPE_LABEL[t.type]}, ${dayLabel(t.date)}`}
                          onClick={() => setEditing(t)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        )}
      </div>
      {list.data && more > 0 && (
        <button type="button" className="show-more" disabled={list.isFetching} onClick={() => setLimit((l) => l + PAGE)}>
          {list.isFetching ? "Loading…" : `Show ${Math.min(PAGE, more)} more (${more} left)`}
        </button>
      )}

      {(editing === "account" || editing === "value") && (
        <Modal title={`Edit ${account.name}`} onClose={() => setEditing(null)}>
          <AccountForm
            existing={account}
            focusField={editing === "value" ? "current_value" : undefined}
            onDone={() => setEditing(null)}
            onDeleted={() => navigate("/accounts")}
          />
        </Modal>
      )}
      {editing && editing !== "account" && editing !== "value" && (
        <Modal title={editing === "new" ? "Add transaction" : "Edit transaction"} onClose={() => setEditing(null)}>
          <TransactionForm existing={editing === "new" ? undefined : editing} accountId={account.id} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </section>
  );
}

/** The one large number: balance, what's owed on the card, or what the holdings are worth. */
function Hero({ s, group, onUpdateValue }: { s: AccountFigures; group: AccountGroup; onUpdateValue?: () => void }) {
  if (group === "credit_card") {
    const owed = Number(s.outstanding ?? 0);
    const limit = s.account.credit_limit === null ? null : Number(s.account.credit_limit);
    const available = Number(s.available_credit ?? 0);
    return (
      <div className="acct-hero">
        <p className="acct-hero-label">{owed < 0 ? "In credit" : "Outstanding"}</p>
        <p className="acct-hero-figure">{money(Math.abs(owed))}</p>
        {limit ? (
          <>
            <Meter ratio={Math.max(owed, 0) / limit} size="lg" />
            <p className={available < 0 ? "small neg-text" : "muted small"}>
              {available < 0 ? `${money(-available)} over the limit of ${money(limit)}` : `${money(available)} available of ${money(limit)} · not cash`}
            </p>
          </>
        ) : (
          <p className="muted small">No credit limit set</p>
        )}
      </div>
    );
  }
  if (group === "share_broker") {
    if (s.current_value === null)
      return (
        <div className="acct-hero">
          <p className="acct-hero-label">Current value</p>
          <p className="acct-hero-figure muted">No value entered</p>
          <p className="muted small">{money(s.invested ?? 0)} invested. The app has no live prices.</p>
          {onUpdateValue && (
            <button type="button" className="tinted small" onClick={onUpdateValue}>
              Update value
            </button>
          )}
        </div>
      );
    const gain = Number(s.unrealized_pl ?? 0);
    const base = Number(s.invested ?? 0);
    return (
      <div className="acct-hero">
        <p className="acct-hero-label">Current value</p>
        <p className="acct-hero-figure">{money(s.current_value)}</p>
        <p className="muted small">
          <span className={gain > 0 ? "pos-text" : gain < 0 ? "neg-text" : undefined}>
            {signedMoney(gain)}
            {base ? ` (${signedPercent(gain / base)})` : ""}
          </span>{" "}
          on {money(base)} invested
        </p>
      </div>
    );
  }
  const balance = Number(s.balance ?? 0);
  return (
    <div className="acct-hero">
      <p className="acct-hero-label">Balance</p>
      <p className={balance < 0 ? "acct-hero-figure neg-text" : "acct-hero-figure"}>{balance < 0 ? signedMoney(balance) : money(balance)}</p>
    </div>
  );
}

/** Everything else about the account, as a short list. */
function Facts({ s, group }: { s: AccountFigures; group: AccountGroup }) {
  const a = s.account;
  const facts: [string, ReactNode][] =
    group === "credit_card"
      ? [
          ["Credit limit", a.credit_limit === null ? "Not set" : money(a.credit_limit)],
          ["Statement", a.statement_day ? `On the ${ordinal(a.statement_day)}` : "Not set"],
          ["Next due", s.next_due_date ? `${dayLabel(s.next_due_date)} · ${fromToday(s.next_due_date)}` : "Not set"],
        ]
      : group === "share_broker"
        ? [
            ["Invested (cost)", money(s.invested ?? 0)],
            ["Cash in account", money(s.balance ?? 0)],
            [
              "Realized P/L",
              <>
                <span className={Number(s.realized_pl) > 0 ? "pos-text" : Number(s.realized_pl) < 0 ? "neg-text" : undefined}>
                  {s.realized_pl === null ? "—" : signedMoney(s.realized_pl)}
                </span>
                {!s.realized_complete && <small className="muted"> Partial: some sells have no cost</small>}
              </>,
            ],
            ["Deposited, all time", money(s.deposited ?? 0)],
            ["Withdrawn, all time", money(s.withdrawn ?? 0)],
            ...(s.current_value !== null ? ([["Value as of", a.valued_on ? dayLabel(a.valued_on) : "Not dated"]] as [string, ReactNode][]) : []),
          ]
        : [
            ["Opening balance", money(a.opening_balance)],
            ["Counted from", a.opening_date ? dayLabel(a.opening_date) : "The first entry"],
          ];
  return (
    <dl className="acct-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The month's money on this account, each figure signed: green in, red out, grey for moves. */
function MonthFigures({ s, group }: { s: AccountFigures; group: AccountGroup }) {
  const refunds = Number(s.month_refunds) ? `After ${money(s.month_refunds)} refunds` : undefined;
  type Figure = { label: string; amount: string; out?: boolean; tone?: "income" | "expense"; note?: string };
  const figures: Figure[] =
    group === "share_broker"
      ? [
          { label: "Deposits", amount: s.month_transfers_in },
          { label: "Withdrawals", amount: s.month_transfers_out, out: true },
          { label: "Bought", amount: s.month_buys, out: true },
          { label: "Sold", amount: s.month_sells },
          { label: "Charges", amount: s.month_expenses, out: true, tone: "expense" },
          { label: "Dividends and other income", amount: s.month_income, tone: "income" },
        ]
      : group === "credit_card"
        ? [
            { label: "Purchases", amount: s.month_expenses, out: true, tone: "expense", note: refunds },
            { label: "Payments", amount: s.month_transfers_in },
            { label: "Cashback and other credits", amount: s.month_income, tone: "income" },
          ]
        : [
            { label: "Income", amount: s.month_income, tone: "income" },
            { label: "Expenses", amount: s.month_expenses, out: true, tone: "expense", note: refunds },
            { label: "Transfers in", amount: s.month_transfers_in },
            { label: "Transfers out", amount: s.month_transfers_out, out: true },
          ];
  return (
    <dl className="card acct-month">
      {figures.map((f) => {
        const n = Number(f.amount);
        const tone = n === 0 || !f.tone ? "" : f.tone === "income" ? "pos-text" : "neg-text";
        return (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd className={`num ${tone}`}>{signedMoney(f.out ? -n : n)}</dd>
            {f.note && <dd className="acct-month-note">{f.note}</dd>}
          </div>
        );
      })}
    </dl>
  );
}
