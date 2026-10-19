import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, patch, post, type Transaction } from "../api";
import { accountItems } from "../components/account-items";
import { CategoryPicker } from "../components/CategoryPicker";
import { Modal } from "../components/Modal";
import { MonthPicker } from "../components/MonthPicker";
import { SearchPicker } from "../components/SearchPicker";
import { useToasts } from "../components/toast-context";
import { TransactionForm } from "../components/TransactionForm";
import { TX_TYPE_LABEL, accountLabel, categoryKind, currentMonth, dayHeading, dayLabel, dayTotals, money, monthLabel, txSign } from "../format";
import { useAccounts, useCategories, useMembers, useRefreshMoney } from "../hooks";
import { Icon } from "../components/Icon";

const PAGE = 100;
const FILTERS = ["q", "type", "category_id", "account_id", "created_by", "uncategorized"];

type Page = { items: Transaction[]; total: number };
type RowState = { kind: "category" | "rule"; status: "saving" | "saved" | "error"; message?: string; categoryId?: string | null };

/** Rows in date order, split into one group per day. */
function byDay(items: Transaction[]): [string, Transaction[]][] {
  const groups = new Map<string, Transaction[]>();
  for (const t of items) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  return [...groups];
}

export function Transactions() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? currentMonth();
  const accounts = useAccounts(true).data ?? [];
  const categories = useCategories(true).data ?? [];
  const members = useMembers().data ?? [];
  const refresh = useRefreshMoney();
  const client = useQueryClient();
  const { hidden } = useToasts();
  const [editing, setEditing] = useState<Transaction | "new" | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [notice, setNotice] = useState("");
  const [announce, setAnnounce] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const timers = useRef<Record<string, number>>({});

  const query = new URLSearchParams(params);
  query.set("month", month);
  query.set("limit", String(limit));
  const key = ["transactions", query.toString()];
  // Keep the old rows on screen while a new filter or search loads, so the table never blanks.
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<Page>(`/transactions?${query}`),
    placeholderData: keepPreviousData,
  });

  useEffect(() => () => Object.values(timers.current).forEach((id) => window.clearTimeout(id)), []);

  function setRow(id: string, state: RowState | null) {
    window.clearTimeout(timers.current[id]);
    setRows((prev) => {
      const next = { ...prev };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
    // "✓ Saved" fades on its own; errors stay until the next try.
    if (state?.status === "saved") timers.current[id] = window.setTimeout(() => setRow(id, null), 2500);
  }

  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
    setLimit(PAGE);
  }

  function clearFilters() {
    const next = new URLSearchParams(params);
    FILTERS.forEach((f) => next.delete(f));
    setParams(next, { replace: true });
    setLimit(PAGE);
  }

  const recategorize = useMutation({
    mutationFn: ({ id, category_id }: { id: string; category_id: string | null }) => patch(`/transactions/${id}`, { category_id }),
    // Show the new category straight away; put the old one back if the save fails.
    onMutate: async ({ id, category_id }) => {
      setRow(id, { kind: "category", status: "saving" });
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<Page>(key);
      client.setQueryData<Page>(key, (page) => page && { ...page, items: page.items.map((t) => (t.id === id ? { ...t, category_id } : t)) });
      return { before };
    },
    onSuccess: (_data, { id }) => {
      setRow(id, { kind: "category", status: "saved" });
      setAnnounce("Category saved");
      refresh();
    },
    onError: (e: Error, { id, category_id }, context) => {
      if (context?.before) client.setQueryData(key, context.before);
      setRow(id, { kind: "category", status: "error", message: e.message, categoryId: category_id });
      setAnnounce(`Couldn't save the category: ${e.message}`);
    },
  });
  const makeRule = useMutation({
    mutationFn: (id: string) => post<{ pattern: string }>(`/transactions/${id}/make-rule`),
    onMutate: (id) => setRow(id, { kind: "rule", status: "saving" }),
    onSuccess: (rule, id) => {
      setRow(id, { kind: "rule", status: "saved", message: `Entries containing "${rule.pattern}" get this category from now on.` });
      setAnnounce(`Rule saved: entries containing "${rule.pattern}" get this category from now on.`);
      refresh();
    },
    onError: (e: Error, id) => {
      setRow(id, { kind: "rule", status: "error", message: e.message });
      setAnnounce(`Couldn't save the rule: ${e.message}`);
    },
  });

  const accountName = (id: string | null) => accountLabel(accounts.find((a) => a.id === id), accounts);
  // Rows deleted a moment ago stay hidden while their Undo is on offer.
  const loaded = list.data?.items ?? [];
  const items = loaded.filter((t) => !hidden.has(t.id));
  const total = (list.data?.total ?? 0) - (loaded.length - items.length);
  const days = byDay(items);
  const filtered = FILTERS.some((f) => params.get(f));
  const showAddedBy = members.length > 1;
  const columns = showAddedBy ? 6 : 5;
  const more = total - items.length;

  function retry(t: Transaction, state: RowState) {
    if (state.kind === "rule") makeRule.mutate(t.id);
    else recategorize.mutate({ id: t.id, category_id: state.categoryId ?? null });
  }

  return (
    <section>
      <div className="toolbar">
        <MonthPicker month={month} onChange={(m) => setFilter("month", m)} />
        <button type="button" className="primary" data-return-focus onClick={() => setEditing("new")}>
          Full form
        </button>
      </div>
      <div className="filters">
        <input type="search" placeholder="Search description or person" aria-label="Search" defaultValue={params.get("q") ?? ""} onChange={(e) => setFilter("q", e.target.value)} />
        <select aria-label="Type" value={params.get("type") ?? ""} onChange={(e) => setFilter("type", e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TX_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <SearchPicker
          label="Category filter"
          none="All categories"
          showGroup
          icon="tag"
          items={categories.map((c) => ({
            id: c.id,
            label: c.sub_name,
            // Income and transfer groups can share a name with an expense group (Gotu), so say which.
            group: c.kind === "expense" ? c.parent_name : `${TX_TYPE_LABEL[c.kind]} · ${c.parent_name}`,
          }))}
          value={params.get("category_id") || null}
          onChange={(id) => setFilter("category_id", id ?? "")}
        />
        <SearchPicker
          label="Account filter"
          none="All accounts"
          icon="bank"
          items={accountItems(accounts)}
          value={params.get("account_id") || null}
          onChange={(id) => setFilter("account_id", id ?? "")}
        />
        {showAddedBy && (
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
          {notice} <button type="button" className="ghost" aria-label="Dismiss" onClick={() => setNotice("")}>
            <Icon name="close" />
          </button>
        </p>
      )}
      <p className="muted small" aria-live="polite">
        {list.data ? `${total} ${total === 1 ? "entry" : "entries"}` : list.isError ? "" : "Loading…"}
        {list.isFetching && list.data && " · Updating…"}
      </p>
      <p className="sr-only" aria-live="polite">
        {announce}
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
            {filtered ? (
              <>
                <p>No entries match these filters.</p>
                <button type="button" className="ghost" onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p>No entries in {monthLabel(month)}.</p>
                <button type="button" className="tinted" onClick={() => setEditing("new")}>
                  Full form
                </button>
              </>
            )}
          </div>
        ) : (
          <table className="tx-table">
            <caption className="sr-only">Entries for {monthLabel(month)}</caption>
            <thead>
              <tr>
                <th>Description</th>
                <th>Category</th>
                <th>Account</th>
                <th className="num">Amount</th>
                {showAddedBy && <th>Added by</th>}
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {!list.data && (
              <tbody aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="skeleton-row">
                    {Array.from({ length: columns }, (_, j) => (
                      <td key={j}>
                        <span className="skeleton" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
            {days.map(([date, dayRows], index) => {
              const totals = dayTotals(dayRows);
              // The last loaded day may carry on past "Show more".
              const partial = more > 0 && index === days.length - 1;
              return (
                <tbody key={date}>
                  <tr className="day-head">
                    <th scope="row" colSpan={3}>
                      {dayHeading(date)}
                    </th>
                    <td className="num">
                      {(totals.spent !== 0 || totals.earned !== 0) && (
                        <DayTotal net={totals.net} spent={totals.spent} earned={totals.earned} partial={partial} />
                      )}
                    </td>
                    <td colSpan={columns - 4} />
                  </tr>
                  {dayRows.map((t) => {
                    const state = rows[t.id];
                    const label = `${t.description || TX_TYPE_LABEL[t.type]}, ${dayLabel(t.date)}`;
                    return (
                      <tr key={t.id} className={t.type}>
                        <td>
                          {t.description || <span className="muted">(no description)</span>}
                          {t.counterparty && <small className="muted"> · {t.counterparty}</small>}
                        </td>
                        <td>
                          <span className="cat-cell">
                            {categoryKind(t.type) ? (
                              <CategoryPicker plain categories={categories.filter((c) => c.is_active || c.id === t.category_id)} kind={categoryKind(t.type)!} value={t.category_id} onChange={(id) => recategorize.mutate({ id: t.id, category_id: id })} />
                            ) : (
                              <span className="muted">{TX_TYPE_LABEL[t.type]}</span>
                            )}
                            {t.type === "refund" && <small className="tag">refund</small>}
                            {state && <RowStatus state={state} onRetry={() => retry(t, state)} />}
                          </span>
                        </td>
                        <td>
                          {accountName(t.account_id)}
                          {t.to_account_id && (
                            <>
                              {" "}
                              <Icon name="arrow-right" />
                              <span className="sr-only">to</span> {accountName(t.to_account_id)}
                            </>
                          )}
                        </td>
                        <td className={`num ${t.type}`}>
                          {txSign(t.type)}
                          {money(t.amount)}
                        </td>
                        {showAddedBy && <td className="muted">{t.created_by_name}</td>}
                        <td className="actions">
                          {t.category_id && t.description && t.type !== "transfer" && t.type !== "refund" && (
                            <button
                              type="button"
                              className="ghost small"
                              title={state?.kind === "rule" && state.message ? state.message : "Use this category for this description from now on"}
                              aria-label={`Save as rule: ${label}`}
                              disabled={state?.kind === "rule" && state.status === "saving"}
                              onClick={() => makeRule.mutate(t.id)}
                            >
                              {state?.kind === "rule" && state.status === "saved" ? (
                                <>
                                  <Icon name="check" /> Rule saved
                                </>
                              ) : (
                                "Save as rule"
                              )}
                            </button>
                          )}
                          <button type="button" className="ghost small" aria-label={`Edit ${label}`} onClick={() => setEditing(t)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        )}
      </div>
      {list.data && more > 0 && (
        <button type="button" className="show-more" disabled={list.isFetching} onClick={() => setLimit((l) => l + PAGE)}>
          {list.isFetching ? "Loading…" : `Show ${Math.min(PAGE, more)} more (${more} left)`}
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

/** The day's net: red when more went out than came in, green when more came in, grey when even. */
function DayTotal({ net, spent, earned, partial }: { net: number; spent: number; earned: number; partial: boolean }) {
  // A salary day nets positive, so show what went out too; colour alone never carries the meaning.
  const detail = earned > 0 && spent > 0 ? `Spent ${money(spent)} · Income ${money(earned)}` : "";
  const tone = net < 0 ? "neg-text" : net > 0 ? "pos-text" : "muted";
  return (
    <span className={`day-total ${tone}`} title={detail || undefined}>
      {net < 0 ? "−" : net > 0 ? "+" : ""}
      {money(Math.abs(net))}
      {partial && <span className="muted"> so far</span>}
      {detail && <small className="day-detail">{detail}</small>}
    </span>
  );
}

function RowStatus({ state, onRetry }: { state: RowState; onRetry: () => void }) {
  if (state.status === "saving") return <span className="row-status muted">Saving…</span>;
  if (state.status === "saved") return state.kind === "category" ? <span className="row-status pos-text">
        <Icon name="check" /> Saved
      </span> : null;
  return (
    <span className="row-status neg-text" title={state.message}>
      Couldn't save
      <button type="button" className="ghost small" onClick={onRetry}>
        Retry
      </button>
    </span>
  );
}
