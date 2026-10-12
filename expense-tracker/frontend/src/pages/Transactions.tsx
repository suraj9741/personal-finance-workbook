import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, patch, post, type Transaction } from "../api";
import { CategoryPicker } from "../components/CategoryPicker";
import { Modal } from "../components/Modal";
import { MonthPicker } from "../components/MonthPicker";
import { TransactionForm } from "../components/TransactionForm";
import { accountLabel, currentMonth, money } from "../format";
import { useAccounts, useCategories, useMembers, useRefreshMoney } from "../hooks";

const PAGE = 100;

export function Transactions() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? currentMonth();
  const accounts = useAccounts(true).data ?? [];
  const categories = useCategories(true).data ?? [];
  const members = useMembers().data ?? [];
  const refresh = useRefreshMoney();
  const [editing, setEditing] = useState<Transaction | "new" | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [notice, setNotice] = useState("");

  const query = new URLSearchParams(params);
  query.set("month", month);
  query.set("limit", String(limit));
  const list = useQuery({
    queryKey: ["transactions", query.toString()],
    queryFn: () => api<{ items: Transaction[]; total: number }>(`/transactions?${query}`),
  });

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(PAGE);
  }

  const recategorize = useMutation({
    mutationFn: ({ id, category_id }: { id: string; category_id: string | null }) => patch(`/transactions/${id}`, { category_id }),
    onSuccess: () => refresh(),
    onError: (e: Error) => setNotice(e.message),
  });
  const makeRule = useMutation({
    mutationFn: (id: string) => post<{ pattern: string }>(`/transactions/${id}/make-rule`),
    onSuccess: (rule) => {
      setNotice(`Rule saved: entries containing "${rule.pattern}" get this category from now on.`);
      refresh();
    },
    onError: (e: Error) => setNotice(e.message),
  });

  const accountName = (id: string | null) => accountLabel(accounts.find((a) => a.id === id), accounts);
  const items = list.data?.items ?? [];

  return (
    <section>
      <div className="toolbar">
        <MonthPicker month={month} onChange={(m) => setFilter("month", m)} />
        <button type="button" className="primary" onClick={() => setEditing("new")}>
          Full form
        </button>
      </div>
      <div className="filters">
        <input type="search" placeholder="Search description or person" aria-label="Search" defaultValue={params.get("q") ?? ""} onChange={(e) => setFilter("q", e.target.value)} />
        <select aria-label="Type" value={params.get("type") ?? ""} onChange={(e) => setFilter("type", e.target.value)}>
          <option value="">All types</option>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer</option>
        </select>
        <select aria-label="Category filter" value={params.get("category_id") ?? ""} onChange={(e) => setFilter("category_id", e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parent_name} › {c.sub_name}
            </option>
          ))}
        </select>
        <select aria-label="Account filter" value={params.get("account_id") ?? ""} onChange={(e) => setFilter("account_id", e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a, accounts)}
            </option>
          ))}
        </select>
        {members.length > 1 && (
          <select aria-label="Added by" value={params.get("created_by") ?? ""} onChange={(e) => setFilter("created_by", e.target.value)}>
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" checked={params.get("uncategorized") === "true"} onChange={(e) => setFilter("uncategorized", e.target.checked ? "true" : "")} />
          Uncategorized only
        </label>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice} <button type="button" className="ghost" onClick={() => setNotice("")}>✕</button>
        </p>
      )}
      <p className="muted small">{list.data ? `${list.data.total} entries` : "Loading…"}</p>
      <div className="table-wrap">
        <table className="tx-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Account</th>
              <th className="num">Amount</th>
              {members.length > 1 && <th>Added by</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className={t.type}>
                <td>{t.date}</td>
                <td>
                  {t.description || <span className="muted">(no description)</span>}
                  {t.counterparty && <small className="muted"> · {t.counterparty}</small>}
                </td>
                <td>
                  <CategoryPicker categories={categories.filter((c) => c.is_active || c.id === t.category_id)} kind={t.type} value={t.category_id} onChange={(id) => recategorize.mutate({ id: t.id, category_id: id })} />
                </td>
                <td>
                  {accountName(t.account_id)}
                  {t.to_account_id && ` → ${accountName(t.to_account_id)}`}
                </td>
                <td className={`num ${t.type}`}>
                  {t.type === "income" ? "+" : t.type === "expense" ? "−" : ""}
                  {money(t.amount, true)}
                </td>
                {members.length > 1 && <td className="muted">{t.created_by_name}</td>}
                <td className="actions">
                  {t.category_id && t.description && t.type !== "transfer" && (
                    <button type="button" className="ghost small" title="Use this category for this description from now on" onClick={() => makeRule.mutate(t.id)}>
                      Save as rule
                    </button>
                  )}
                  <button type="button" className="ghost small" onClick={() => setEditing(t)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && items.length < list.data.total && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)}>
          Show more
        </button>
      )}
      {editing && (
        <Modal title={editing === "new" ? "Add transaction" : "Edit transaction"} onClose={() => setEditing(null)}>
          <TransactionForm existing={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </section>
  );
}
