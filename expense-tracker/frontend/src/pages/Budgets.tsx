import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, post, put, type MonthStats } from "../api";
import { MonthPicker } from "../components/MonthPicker";
import { currentMonth, money, shiftMonth } from "../format";
import { useCategories, useMe, useRefreshMoney } from "../hooks";

interface BudgetsOut {
  month: string;
  items: { category_id: string; amount: string }[];
}

export function Budgets() {
  const [month, setMonth] = useState(currentMonth);
  const isOwner = useMe().data?.role === "owner";
  const categories = (useCategories().data ?? []).filter((c) => c.kind === "expense");
  const refresh = useRefreshMoney();
  const budgets = useQuery({ queryKey: ["budgets", month], queryFn: () => api<BudgetsOut>(`/budgets?month=${month}`) });
  const stats = useQuery({ queryKey: ["stats", month, "household"], queryFn: () => api<MonthStats>(`/stats/month?month=${month}&scope=household`) });
  // Unsaved edits sit on top of the saved budgets, and are dropped when the month changes.
  const [edits, setEdits] = useState<{ month: string; values: Record<string, string> }>({ month, values: {} });
  const [message, setMessage] = useState("");
  const saved = useMemo(() => Object.fromEntries((budgets.data?.items ?? []).map((i) => [i.category_id, i.amount])), [budgets.data]);
  const draft: Record<string, string> = { ...saved, ...(edits.month === month ? edits.values : {}) };
  const setDraft = (id: string, value: string) =>
    setEdits((e) => ({ month, values: { ...(e.month === month ? e.values : {}), [id]: value } }));

  const actual = useMemo(() => Object.fromEntries((stats.data?.categories ?? []).map((l) => [l.category_id, l.actual])), [stats.data]);
  const grouped = useMemo(() => {
    const map = new Map<string, typeof categories>();
    for (const c of categories) map.set(c.parent_name, [...(map.get(c.parent_name) ?? []), c]);
    return [...map.entries()];
  }, [categories]);
  const total = Object.values(draft).reduce((sum, v) => sum + (Number(v) || 0), 0);

  const save = useMutation({
    mutationFn: () => put(`/budgets`, { month, items: Object.entries(draft).filter(([, v]) => Number(v) > 0).map(([category_id, amount]) => ({ category_id, amount })) }),
    onSuccess: () => {
      setMessage("Budgets saved");
      setEdits({ month, values: {} });
      refresh();
    },
    onError: (e: Error) => setMessage(e.message),
  });
  const copy = useMutation({
    mutationFn: () => post(`/budgets/copy`, { from_month: shiftMonth(month, -1), to_month: month }),
    onSuccess: () => {
      setMessage("Copied last month's budgets");
      refresh();
    },
    onError: (e: Error) => setMessage(e.message),
  });

  return (
    <section>
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} />
        {isOwner && (
          <div className="row">
            <button type="button" onClick={() => copy.mutate()}>
              Copy last month
            </button>
            <button type="button" className="primary" onClick={() => save.mutate()}>
              Save budgets
            </button>
          </div>
        )}
      </div>
      <p className="muted small">
        Total budget {money(total)}. {isOwner ? "Leave a line empty for no budget." : "Only the household owner can change budgets."}
      </p>
      {message && <p className="notice">{message}</p>}
      <div className="budget-grid">
        {grouped.map(([parent, subs]) => (
          <div className="card" key={parent}>
            <h3>{parent}</h3>
            {subs.map((c) => (
              <label key={c.id} className="budget-line">
                <span>{c.sub_name}</span>
                <small className="muted">spent {money(actual[c.id] ?? 0)}</small>
                <input inputMode="decimal" placeholder="—" disabled={!isOwner} value={draft[c.id] ?? ""} onChange={(e) => setDraft(c.id, e.target.value.replace(/[^\d.]/g, ""))} aria-label={`${parent} ${c.sub_name} budget`} />
              </label>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
