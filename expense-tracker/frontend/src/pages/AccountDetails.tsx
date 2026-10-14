import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type AccountFigures, type Transaction } from "../api";
import { AccountForm } from "../components/AccountForm";
import { Modal } from "../components/Modal";
import { MonthPicker } from "../components/MonthPicker";
import { TransactionForm } from "../components/TransactionForm";
import {
  GROUP_ICON,
  GROUP_LABEL,
  TX_TYPE_LABEL,
  accountLabel,
  categoryLabel,
  currentMonth,
  groupOf,
  money,
} from "../format";
import { useAccounts, useCategories, useMe } from "../hooks";
import { Kpi } from "../components/Kpi";

const PAGE = 100;

/** One account: its figures, its month, and every entry on it. */
export function AccountDetails() {
  const { id = "" } = useParams();
  const me = useMe().data;
  const accounts = useAccounts(true).data ?? [];
  const categories = useCategories(true).data ?? [];
  const [month, setMonth] = useState(currentMonth);
  const [filters, setFilters] = useState({ date_from: "", date_to: "", type: "", category_id: "" });
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<"account" | "new" | Transaction | null>(null);

  const summary = useQuery({
    queryKey: ["account-summary", id, month],
    queryFn: () => api<AccountFigures>(`/accounts/${id}/summary?month=${month}`),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const query = new URLSearchParams({ account_id: id, limit: String(limit) });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const list = useQuery({
    queryKey: ["transactions", "account", query.toString()],
    queryFn: () => api<{ items: Transaction[]; total: number }>(`/transactions?${query}`),
  });

  if (summary.isLoading) return <p className="muted">Loading…</p>;
  if (summary.isError)
    return (
      <section>
        <p className="error">{summary.error instanceof ApiError && summary.error.status === 404 ? "Account not found." : summary.error.message}</p>
        <Link to="/accounts">Back to accounts</Link>
      </section>
    );
  const s = summary.data!;
  const account = s.account;
  const group = groupOf(account.pay_type);
  const canManage = account.visibility === "private" ? account.owner_user_id === me?.id : me?.role === "owner";
  const items = list.data?.items ?? [];
  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setLimit(PAGE);
  };
  // Seen from this account: money in is +, money out is −.
  const sign = (t: Transaction) =>
    t.type === "transfer" ? (t.to_account_id === account.id ? "+" : "−") : ["income", "refund", "sell"].includes(t.type) ? "+" : "−";

  return (
    <section className="account-details">
      <p className="small">
        <Link to="/accounts">← Accounts</Link>
      </p>
      <div className="detail-head">
        <div>
          <h1>
            <span aria-hidden="true">{GROUP_ICON[group]}</span> {account.name}
            {!account.is_active && <small className="tag">inactive</small>}
            {account.visibility === "private" && <small className="tag">private</small>}
          </h1>
          <p className="muted small">
            {account.pay_type === "cash" ? "Cash" : GROUP_LABEL[group]}
            {account.institution && ` · ${account.institution}`}
            {account.opening_date && ` · opened ${account.opening_date}`}
          </p>
          {account.description && <p className="small">{account.description}</p>}
        </div>
        <div className="row wrap">
          {account.is_active && (
            <button type="button" className="primary" onClick={() => setEditing("new")}>
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

      <div className="kpis">
        {group === "credit_card" ? (
          <>
            <Kpi label="Outstanding" value={money(s.outstanding)} />
            <Kpi label="Credit limit" value={money(account.credit_limit)} />
            <Kpi label="Available credit" value={money(s.available_credit)} note="Not cash" />
            <Kpi label="Next due date" value={s.next_due_date ?? "Not set"} note={account.statement_day ? `Statement on day ${account.statement_day}` : undefined} />
          </>
        ) : group === "share_broker" ? (
          <>
            <Kpi label="Invested (cost)" value={money(s.invested)} />
            <Kpi label="Current value" value={s.current_value === null ? "Not entered" : money(s.current_value)} note={account.valued_on ? `As of ${account.valued_on}` : "Enter it with Edit account"} />
            <Kpi label="Unrealized P/L" value={s.unrealized_pl === null ? "—" : money(s.unrealized_pl)} tone={tone(s.unrealized_pl)} />
            <Kpi
              label="Realized P/L"
              value={s.realized_pl === null ? "—" : money(s.realized_pl)}
              tone={tone(s.realized_pl)}
              note={s.realized_complete ? "From sells with a cost" : "Partial: some sells have no cost"}
            />
            <Kpi label="Cash in account" value={money(s.balance)} />
            <Kpi label="Deposited" value={money(s.deposited)} note="All time" />
            <Kpi label="Withdrawn" value={money(s.withdrawn)} note="All time" />
          </>
        ) : (
          <>
            <Kpi label="Current balance" value={money(s.balance)} tone={Number(s.balance) < 0 ? "bad" : undefined} />
            <Kpi label="Opening balance" value={money(account.opening_balance)} note={account.opening_date ? `On ${account.opening_date}` : "Before every entry"} />
          </>
        )}
      </div>

      <div className="toolbar">
        <h2 className="section-title">Month</h2>
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      <div className="kpis">
        {group === "share_broker" ? (
          <>
            <Kpi label="Deposits" value={money(s.month_transfers_in)} />
            <Kpi label="Withdrawals" value={money(s.month_transfers_out)} />
            <Kpi label="Bought" value={money(s.month_buys)} />
            <Kpi label="Sold" value={money(s.month_sells)} />
            <Kpi label="Charges" value={money(s.month_expenses)} />
            <Kpi label="Dividends and other income" value={money(s.month_income)} />
          </>
        ) : group === "credit_card" ? (
          <>
            <Kpi label="Purchases" value={money(s.month_expenses)} note={Number(s.month_refunds) ? `After ${money(s.month_refunds)} refunds` : undefined} />
            <Kpi label="Payments" value={money(s.month_transfers_in)} />
            <Kpi label="Cashback and other credits" value={money(s.month_income)} />
          </>
        ) : (
          <>
            <Kpi label="Income" value={money(s.month_income)} />
            <Kpi label="Expenses" value={money(s.month_expenses)} note={Number(s.month_refunds) ? `After ${money(s.month_refunds)} refunds` : undefined} />
            <Kpi label="Transfers in" value={money(s.month_transfers_in)} />
            <Kpi label="Transfers out" value={money(s.month_transfers_out)} />
          </>
        )}
      </div>

      <h2 className="section-title">Transactions</h2>
      <div className="filters">
        <label className="check">
          From <input type="date" aria-label="From date" value={filters.date_from} onChange={(e) => setFilter("date_from", e.target.value)} />
        </label>
        <label className="check">
          To <input type="date" aria-label="To date" value={filters.date_to} onChange={(e) => setFilter("date_to", e.target.value)} />
        </label>
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
      </div>
      <p className="muted small">{list.data ? `${list.data.total} entries` : list.isError ? "Couldn't load entries" : "Loading…"}</p>
      {list.isSuccess && list.data.total === 0 ? (
        <p className="muted">No entries{Object.values(filters).some(Boolean) ? " match these filters" : " on this account yet"}.</p>
      ) : (
        <div className="table-wrap">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Type</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>
                    {t.description || <span className="muted">(no description)</span>}
                    {t.type === "transfer" && (
                      <small className="muted">
                        {" "}
                        {t.to_account_id === account.id
                          ? `from ${accountLabel(accounts.find((a) => a.id === t.account_id), accounts)}`
                          : `to ${accountLabel(accounts.find((a) => a.id === t.to_account_id), accounts)}`}
                      </small>
                    )}
                  </td>
                  <td>{TX_TYPE_LABEL[t.type]}</td>
                  <td>
                    {t.type === "buy" || t.type === "sell" || (t.type === "transfer" && !t.category_id)
                      ? ""
                      : categoryLabel(categories.find((c) => c.id === t.category_id))}
                  </td>
                  <td className={`num ${sign(t) === "+" ? "income" : "expense"}`}>
                    {sign(t)}
                    {money(t.amount, true)}
                  </td>
                  <td className="actions">
                    <button type="button" className="ghost small" onClick={() => setEditing(t)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && items.length < list.data.total && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)}>
          Show more
        </button>
      )}

      {editing === "account" && (
        <Modal title={`Edit ${account.name}`} onClose={() => setEditing(null)}>
          <AccountForm existing={account} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {editing && editing !== "account" && (
        <Modal title={editing === "new" ? "Add transaction" : "Edit transaction"} onClose={() => setEditing(null)}>
          <TransactionForm existing={editing === "new" ? undefined : editing} accountId={account.id} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </section>
  );
}

const tone = (value: string | null) => (value === null ? undefined : Number(value) < 0 ? "bad" : "good");
