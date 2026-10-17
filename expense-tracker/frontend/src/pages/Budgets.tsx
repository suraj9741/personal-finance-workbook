import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, put, type Category, type MonthStats } from "../api";
import { BusyLabel } from "../components/FormBits";
import { MonthPicker } from "../components/MonthPicker";
import { budgetDiff, currentMonth, money, monthLabel, shiftMonth } from "../format";
import { useCategories, useMe, useRefreshMoney } from "../hooks";

interface BudgetsOut {
  month: string;
  carries_forward: boolean;
  items: { category_id: string; amount: string; this_month_only: boolean; set_in: string }[];
  next_changes: { category_id: string; month: string; amount: string }[];
}

type Kind = "expense" | "income";
/** Unsaved budget edits, per month: month → category id → amount typed. */
type Drafts = Record<string, Record<string, string>>;

// Per tab, so edits survive switching month or page but not closing the tab (which warns first).
const DRAFTS_KEY = "et:budgetDrafts";

function readDrafts(): Drafts {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFTS_KEY) ?? "{}") as Drafts;
  } catch {
    return {};
  }
}

export function Budgets() {
  const [month, setMonth] = useState(currentMonth);
  const isOwner = useMe().data?.role === "owner";
  const allCategories = useCategories().data;
  const refresh = useRefreshMoney();
  const budgets = useQuery({ queryKey: ["budgets", month], queryFn: () => api<BudgetsOut>(`/budgets?month=${month}`) });
  const stats = useQuery({ queryKey: ["stats", month, "household"], queryFn: () => api<MonthStats>(`/stats/month?month=${month}&scope=household`) });
  // Unsaved edits sit on top of the saved budgets and are kept per month until saved or discarded.
  const [drafts, setDrafts] = useState<Drafts>(readDrafts);
  const [onlyThisMonth, setOnlyThisMonth] = useState(false);
  const [message, setMessage] = useState("");
  const carries = budgets.data?.carries_forward ?? true;

  const savedLines = useMemo(() => new Map((budgets.data?.items ?? []).map((i) => [i.category_id, i])), [budgets.data]);
  const pending = useMemo(() => drafts[month] ?? {}, [drafts, month]);
  const value = (id: string) => pending[id] ?? savedLines.get(id)?.amount ?? "";
  const setDraft = (id: string, v: string) => setDrafts((d) => ({ ...d, [month]: { ...(d[month] ?? {}), [id]: v } }));
  const changed = Object.entries(pending).filter(([id, v]) => Number(v || 0) !== Number(savedLines.get(id)?.amount ?? 0));
  const discard = () =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[month];
      return next;
    });
  const hasDrafts = Object.values(drafts).some((values) => Object.keys(values).length > 0);

  useEffect(() => {
    try {
      if (hasDrafts) sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      else sessionStorage.removeItem(DRAFTS_KEY);
    } catch {
      /* storage unavailable: drafts last until reload */
    }
  }, [drafts, hasDrafts]);

  // Closing or reloading the tab with unsaved budgets asks first.
  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts]);

  const nextChange = useMemo(() => new Map((budgets.data?.next_changes ?? []).map((n) => [n.category_id, n])), [budgets.data]);
  const actual = useMemo(() => new Map((stats.data?.categories ?? []).map((l) => [l.category_id, Number(l.actual)])), [stats.data]);

  const save = useMutation({
    mutationFn: () =>
      put(`/budgets`, {
        month,
        items: changed.map(([category_id, amount]) => ({ category_id, amount: amount || "0", this_month_only: onlyThisMonth })),
      }),
    onSuccess: () => {
      const forward = carries && !onlyThisMonth;
      // A default set earlier for a later month still takes over from that month.
      const stops = forward
        ? changed.flatMap(([id]) => {
            const n = nextChange.get(id);
            const c = allCategories?.find((x) => x.id === id);
            return n && c ? [`${c.sub_name} keeps ${money(n.amount)} from ${monthLabel(n.month)}, which you set before.`] : [];
          })
        : [];
      setMessage(
        [forward ? `Budgets saved for ${monthLabel(month)} and the months after it.` : `Budgets saved for ${monthLabel(month)} only.`, ...stops].join(" "),
      );
      discard();
      refresh();
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const note = (id: string) => {
    const line = savedLines.get(id);
    const edited = pending[id] !== undefined;
    if (line?.this_month_only && !edited) return "this month only";
    const parts = [];
    if (line && !edited && line.set_in !== month) parts.push(`since ${monthLabel(line.set_in)}`);
    const next = nextChange.get(id);
    if (next && carries && !(edited && onlyThisMonth)) {
      parts.push(`until ${monthLabel(shiftMonth(next.month, -1))}, then ${money(next.amount)}`);
    }
    return parts.length ? parts.join(", ") : null;
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
        {isOwner && carries && (
          <label className="row small">
            <input type="checkbox" checked={onlyThisMonth} onChange={(e) => setOnlyThisMonth(e.target.checked)} />
            Only this month
          </label>
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
      {isOwner && changed.length > 0 && (
        <div className="unsaved-bar" role="region" aria-label="Unsaved budgets">
          <span>
            {changed.length} unsaved {changed.length === 1 ? "change" : "changes"} for {monthLabel(month)}
          </span>
          <div className="row">
            <button type="button" className="ghost" disabled={save.isPending} onClick={discard}>
              Discard
            </button>
            <button type="button" className="primary" disabled={save.isPending} onClick={() => save.mutate()}>
              <BusyLabel busy={save.isPending} idle="Save budgets" working="Saving…" />
            </button>
          </div>
        </div>
      )}
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
