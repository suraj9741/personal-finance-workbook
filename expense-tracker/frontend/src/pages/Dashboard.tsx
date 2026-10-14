import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Attention, type MonthStats, type TrendPoint } from "../api";
import { FinancialOverview } from "../components/FinancialOverview";
import { MonthPicker } from "../components/MonthPicker";
import { TrendChart } from "../components/TrendChart";
import { currentMonth, money, percent } from "../format";
import { Kpi } from "../components/Kpi";

type Scope = "household" | "me";

export function Dashboard() {
  const [month, setMonth] = useState(currentMonth);
  const [scope, setScope] = useState<Scope>("household");
  const stats = useQuery({
    queryKey: ["stats", month, scope],
    queryFn: () => api<MonthStats>(`/stats/month?month=${month}&scope=${scope}`),
  });
  const trend = useQuery({
    queryKey: ["trend", month, scope],
    queryFn: () => api<TrendPoint[]>(`/stats/trend?months=6&end_month=${month}&scope=${scope}`),
  });
  const attention = useQuery({
    queryKey: ["attention", month],
    queryFn: () => api<Attention>(`/stats/attention?month=${month}`),
  });
  const s = stats.data;
  const a = attention.data;
  const items: { text: string; to?: string }[] = [];
  if (a) {
    if (a.uncategorized) items.push({ text: `${a.uncategorized} ${a.uncategorized === 1 ? "entry has" : "entries have"} no category`, to: `/transactions?month=${month}&uncategorized=true` });
    for (const line of a.over_budget)
      items.push({ text: `${line.parent_name} › ${line.sub_name} is over budget: ${money(line.actual)} of ${money(line.budget)}`, to: `/transactions?month=${month}&category_id=${line.category_id}` });
    for (const loan of a.old_loans)
      items.push({ text: `${loan.counterparty} still owes ${money(loan.outstanding)} (lent ${loan.last_lent_on})` });
    if (a.no_income) items.push({ text: "No income recorded this month. Missing a paycheck?" });
    if (a.credit_card_category_used)
      items.push({ text: `${a.credit_card_category_used} entries use Debt › Credit cards. That double-counts card spends; use a Bank to Credit transfer.` });
  }

  return (
    <section className="dashboard">
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} />
        <div className="segmented" role="radiogroup" aria-label="Whose numbers">
          {(["household", "me"] as Scope[]).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={scope === v} className={scope === v ? "active" : ""} onClick={() => setScope(v)}>
              {v === "household" ? "Household" : "Just me"}
            </button>
          ))}
        </div>
      </div>
      {scope === "household" && <p className="muted small">Household totals include shared accounts and your own private accounts.</p>}

      <FinancialOverview month={month} />

      <h2 className="section-title">
        This month by category {scope === "me" && <small className="muted">(just me)</small>}
      </h2>
      <div className="kpis">
        <Kpi label="Income" value={money(s?.income)} />
        <Kpi label="Spent" value={money(s?.spend)} />
        <Kpi label="Saved" value={money(s?.saved)} tone={s && Number(s.saved) < 0 ? "bad" : "good"} />
        <Kpi label="Savings rate" value={percent(s?.savings_rate ?? null)} />
      </div>
      <p className="muted small">
        Invested {money(s?.invested)} · Lent {money(s?.lent)} · Repaid to you {money(s?.repaid)} · Transfers are not counted
      </p>

      <div className="grid-2">
        <div className="card">
          <h2>Needs attention</h2>
          {a && items.length === 0 && <p className="muted">Nothing needs attention this month.</p>}
          <ul className="attention">
            {items.map((item) => (
              <li key={item.text}>{item.to ? <Link to={item.to}>{item.text}</Link> : item.text}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Saved per month</h2>
          {trend.data && <TrendChart points={trend.data} />}
        </div>
      </div>

      <div className="card">
        <h2>
          Budget vs actual <small className="muted">budget total {money(s?.budget_total)}</small>
        </h2>
        {s && !s.categories.some((l) => l.kind === "expense") && (
          <p className="muted">
            No spending yet this month. <Link to="/budgets">Set budgets</Link>
          </p>
        )}
        <ul className="bars">
          {s?.categories.filter((l) => l.kind === "expense").map((line) => {
            const actual = Number(line.actual);
            const budget = line.budget ? Number(line.budget) : null;
            const pct = budget ? Math.min(100, (actual / budget) * 100) : 100;
            return (
              <li key={line.category_id}>
                <span className="bar-label">
                  {line.parent_name} › {line.sub_name}
                </span>
                <span className="bar-track">
                  <span className={`bar-fill ${line.over_budget ? "over" : budget ? "" : "nobudget"}`} style={{ width: `${pct}%` }} />
                </span>
                <span className="bar-value">
                  {money(actual)}
                  {budget !== null && <small> / {money(budget)}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
