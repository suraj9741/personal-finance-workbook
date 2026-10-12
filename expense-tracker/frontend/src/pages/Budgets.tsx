import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, put, type Category, type MonthStats } from "../api";
import { MonthPicker } from "../components/MonthPicker";
import { budgetDiff, currentMonth, money, monthLabel } from "../format";
import { useCategories, useMe, useRefreshMoney } from "../hooks";

interface BudgetsOut {
  month: string;
  carries_forward: boolean;
  items: { category_id: string; amount: string; this_month_only: boolean; set_in: string }[];
}

type Kind = "expense" | "income";

export function Budgets() {
  const [month, setMonth] = useState(currentMonth);
  const isOwner = useMe().data?.role === "owner";
  const allCategories = useCategories().data;
  const refresh = useRefreshMoney();
  const budgets = useQuery({ queryKey: ["budgets", month], queryFn: () => api<BudgetsOut>(`/budgets?month=${month}`) });
  const stats = useQuery({ queryKey: ["stats", month, "household"], queryFn: () => api<MonthStats>(`/stats/month?month=${month}&scope=household`) });
  // Unsaved edits sit on top of the saved budgets, and are dropped when the month changes.
  const [edits, setEdits] = useState<{ month: string; values: Record<string, string> }>({ month, values: {} });
  const [onlyThisMonth, setOnlyThisMonth] = useState(false);
  const [message, setMessage] = useState("");
  const carries = budgets.data?.carries_forward ?? true;

  const savedLines = useMemo(() => new Map((budgets.data?.items ?? []).map((i) => [i.category_id, i])), [budgets.data]);
  const pending = edits.month === month ? edits.values : {};
  const value = (id: string) => pending[id] ?? savedLines.get(id)?.amount ?? "";
  const setDraft = (id: string, v: string) => setEdits((e) => ({ month, values: { ...(e.month === month ? e.values : {}), [id]: v } }));
  const changed = Object.entries(pending).filter(([id, v]) => Number(v || 0) !== Number(savedLines.get(id)?.amount ?? 0));

  const actual = useMemo(() => new Map((stats.data?.categories ?? []).map((l) => [l.category_id, Number(l.actual)])), [stats.data]);

  const save = useMutation({
    mutationFn: () =>
      put(`/budgets`, {
        month,
        items: changed.map(([category_id, amount]) => ({ category_id, amount: amount || "0", this_month_only: onlyThisMonth })),
      }),
    onSuccess: () => {
      setMessage(carries && !onlyThisMonth ? `Budgets saved for ${monthLabel(month)} and the months after it` : `Budgets saved for ${monthLabel(month)} only`);
      setEdits({ month, values: {} });
      refresh();
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const note = (id: string) => {
    if (pending[id] !== undefined) return null;
    const line = savedLines.get(id);
    if (!line) return null;
    if (line.this_month_only) return "this month only";
    return line.set_in !== month ? `since ${monthLabel(line.set_in)}` : null;
  };

  return (
    <section>
      <div className="toolbar">
        <MonthPicker
          month={month}
          onChange={(m) => {
            setMonth(m);
            setMessage("");
          }}
        />
        {isOwner && (
          <div className="row">
            {carries ? (
              <label className="row small">
                <input type="checkbox" checked={onlyThisMonth} onChange={(e) => setOnlyThisMonth(e.target.checked)} />
                Only this month
              </label>
            ) : null}
            <button type="button" className="primary" disabled={changed.length === 0} onClick={() => save.mutate()}>
              Save budgets
            </button>
          </div>
        )}
      </div>
      <p className="muted small">
        {!isOwner
          ? "Only the household owner can change budgets."
          : !carries
            ? "This month is in the past. Changes here apply to this month only."
            : onlyThisMonth
              ? "Changes apply to this month only. Later months keep their budget."
              : "A budget you set applies to this month and every month after it, until you change it. Earlier months keep theirs."}
      </p>
      {message && <p className="notice">{message}</p>}
      {allCategories &&
        (["expense", "income"] as const).map((kind) => (
          <BudgetSection
            key={kind}
            kind={kind}
            categories={allCategories.filter((c) => c.kind === kind && c.is_active)}
            value={value}
            actual={actual}
            note={note}
            onChange={isOwner ? setDraft : undefined}
          />
        ))}
    </section>
  );
}

function BudgetSection({
  kind,
  categories,
  value,
  actual,
  note,
  onChange,
}: {
  kind: Kind;
  categories: Category[];
  value: (id: string) => string;
  actual: Map<string, number>;
  note: (id: string) => string | null;
  onChange?: (id: string, v: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) map.set(c.parent_name, [...(map.get(c.parent_name) ?? []), c]);
    return [...map.entries()];
  }, [categories]);
  if (categories.length === 0) return null;
  const sum = (list: Category[], f: (c: Category) => number) => list.reduce((t, c) => t + f(c), 0);
  const budgetOf = (c: Category) => Number(value(c.id)) || 0;
  const actualOf = (c: Category) => actual.get(c.id) ?? 0;
  const totals = (list: Category[]) => {
    const b = sum(list, budgetOf);
    const a = sum(list, actualOf);
    return { b, a, d: budgetDiff(kind, b, a) };
  };
  const all = totals(categories);
  const spentLabel = kind === "expense" ? "Spent" : "Earned";
  const title = kind === "expense" ? "Expense" : "Income";

  return (
    <div className="budget-section">
      <h2>{title}: budget vs actual</h2>
      <dl className="budget-totals" aria-label={`${title} totals`}>
        <div>
          <dt>Budget</dt>
          <dd>{money(all.b)}</dd>
        </div>
        <div>
          <dt>{spentLabel}</dt>
          <dd>{money(all.a)}</dd>
        </div>
        <div>
          <dt>Diff</dt>
          <dd className={all.d < 0 ? "bad" : "good"}>{money(all.d)}</dd>
        </div>
      </dl>
      <div className="budget-grid">
        {grouped.map(([parent, subs]) => {
          const t = totals(subs);
          return (
            <div className="card" key={parent}>
              <h3>
                {parent} <small className={t.d < 0 ? "bad" : "muted"}>{money(t.d)}</small>
              </h3>
              <div className="budget-line budget-head muted small" aria-hidden="true">
                <span />
                <span>Budget</span>
                <span>{spentLabel}</span>
                <span>Diff</span>
              </div>
              {subs.map((c) => {
                const d = budgetDiff(kind, budgetOf(c), actualOf(c));
                const hint = note(c.id);
                return (
                  <div key={c.id} className="budget-line">
                    <span>
                      {c.sub_name}
                      {hint && <small className="muted budget-note">{hint}</small>}
                    </span>
                    <input
                      inputMode="decimal"
                      placeholder="—"
                      disabled={!onChange}
                      value={value(c.id)}
                      onChange={(e) => onChange?.(c.id, e.target.value.replace(/[^\d.]/g, ""))}
                      aria-label={`${parent} ${c.sub_name} budget`}
                    />
                    <span className="num">{money(actualOf(c))}</span>
                    <span className={`num ${d < 0 ? "bad" : d > 0 ? "good" : "muted"}`} aria-label={`${parent} ${c.sub_name} diff`}>
                      {money(d)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
