import { Amounts } from "../components/Amounts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Attention, type MonthStats, type TrendPoint } from "../api";
import { DashboardHero } from "../components/DashboardHero";
import { FinancialOverview } from "../components/FinancialOverview";
import { MonthPicker } from "../components/MonthPicker";
import { TrendChart } from "../components/TrendChart";
import { budgetSplit, budgetTone, currentMonth, money } from "../format";
import { SegmentedRadio } from "../components/SegmentedRadio";
import { Meter } from "../components/Meter";
import { Icon } from "../components/Icon";
import { YearPicker } from "../components/YearPicker";
import { YearView } from "../components/YearView";

type Scope = MonthStats["scope"];
const SCOPES: Scope[] = ["household", "me"];
const SCOPE_LABEL: Record<Scope, string> = { household: "Household", me: "Just me" };
const SCOPE_CAPTION: Record<Scope, string> = {
  household: "Household · everyone's shared accounts plus your private ones",
  me: "Just me · only your own accounts, never a family member's",
};

/** Household / Just me: a radio group, so arrows move and Tab enters once. */
function ScopeSwitch({ scope, onChange, controls = "dash-glance dash-categories" }: { scope: Scope; onChange: (next: Scope) => void; controls?: string }) {
  return (
    <SegmentedRadio
      label="Show figures for"
      describedBy="scope-caption"
      controls={controls}
      value={scope}
      onChange={onChange}
      options={SCOPES.map((v) => ({ value: v, label: SCOPE_LABEL[v] }))}
    />
  );
}

type View = "month" | "year";

/** Month / Year: which dashboard shows. The year view lives in the URL, so a reload keeps it. */
function ViewSwitch({ view, onChange }: { view: View; onChange: (next: View) => void }) {
  return (
    <SegmentedRadio
      label="Dashboard view"
      className="segmented view-switch"
      value={view}
      onChange={onChange}
      options={[
        { value: "month", label: "Month" },
        { value: "year", label: "Year" },
      ]}
    />
  );
}

export function Dashboard() {
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState<Scope>("household");
  const view: View = params.get("view") === "year" ? "year" : "month";
  const thisYear = Number(currentMonth().slice(0, 4));
  const year = Number(params.get("year")) || thisYear;

  function show(next: View, nextYear = year) {
    setParams(next === "year" ? { view: "year", ...(nextYear !== thisYear ? { year: String(nextYear) } : {}) } : {}, { replace: true });
  }

  if (view === "year") {
    return (
      <section className="dashboard">
        <div className="toolbar">
          <h1>Dashboard</h1>
          <ViewSwitch view={view} onChange={show} />
          <YearPicker year={year} max={thisYear} onChange={(y) => show("year", y)} />
          <ScopeSwitch scope={scope} onChange={setScope} controls="year-view" />
        </div>
        <YearView year={year} scope={scope} />
      </section>
    );
  }
  return <MonthDashboard scope={scope} setScope={setScope} view={view} onView={show} />;
}

function MonthDashboard({ scope, setScope, view, onView }: { scope: Scope; setScope: (s: Scope) => void; view: View; onView: (v: View) => void }) {
  const [month, setMonth] = useState(currentMonth);
  // Old numbers stay on screen (dimmed) while a new month or scope loads, so nothing blanks or jumps.
  const stats = useQuery({
    queryKey: ["stats", month, scope],
    queryFn: () => api<MonthStats>(`/stats/month?month=${month}&scope=${scope}`),
    placeholderData: keepPreviousData,
  });
  const trend = useQuery({
    queryKey: ["trend", month, scope],
    queryFn: () => api<TrendPoint[]>(`/stats/trend?months=6&end_month=${month}&scope=${scope}`),
    placeholderData: keepPreviousData,
  });
  // Needs attention is always household, so it sits outside the switched part of the page.
  const attention = useQuery({
    queryKey: ["attention", month],
    queryFn: () => api<Attention>(`/stats/attention?month=${month}`),
    placeholderData: keepPreviousData,
  });
  const s = stats.data ?? undefined;
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
  const allClear = a && items.length === 0;

  // Budgets belong to the whole household, so comparing your share with them would flag false "over"s.
  // In Just me the bars drop budgets and scale to your largest category instead.
  const me = s?.scope === "me";
  const split = budgetSplit(s?.categories ?? []);
  const lines = (s?.categories ?? []).filter((l) => l.kind === "expense" && (!me || Number(l.actual) !== 0));
  const largest = Math.max(1, ...lines.map((l) => Number(l.actual)));

  return (
    <section className="dashboard">
      <div className="toolbar">
        <h1>Dashboard</h1>
        <ViewSwitch view={view} onChange={onView} />
        <MonthPicker month={month} onChange={setMonth} />
        <ScopeSwitch scope={scope} onChange={setScope} />
      </div>
      <p id="scope-caption" className="hero-caption">
        {SCOPE_CAPTION[scope]}
      </p>

      <DashboardHero month={month} scope={scope} stats={stats} />

      <div className={`card attention-card ${allClear ? "quiet" : ""}`}>
        <div className="card-head">
          <h2>Needs attention</h2>
          <span className="card-caption">Household</span>
        </div>
        {allClear ? (
          <p className="muted">Nothing needs attention this month.</p>
        ) : (
          <ul className="attention">
            {items.map((item) => (
              <li key={item.text}>
                {item.to ? (
                  <Link className="attention-link" to={item.to}>
                    <Amounts>{item.text}</Amounts>
                    <Icon name="chevron-right" />
                  </Link>
                ) : (
                  <Amounts>{item.text}</Amounts>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className="dash-section" aria-labelledby="cat-h">
        <h2 id="cat-h" className="section-title">
          This month by category{scope === "me" && <span className="muted"> · Just me</span>}
        </h2>
        <div
          id="dash-categories"
          className="dash-section-body"
          aria-busy={stats.isPlaceholderData || trend.isPlaceholderData || undefined}
        >
          <div className="card">
            <h3>
              Budget vs actual{" "}
              {s && !me && (
                <small className="muted">
                  <Amounts>{split.spend > 0 ? `spending budget ${money(split.spend)}` : "no spending budget"}</Amounts>
                  {split.saving > 0 && <Amounts>{` + ${money(split.saving)} planned savings`}</Amounts>}
                </small>
              )}
            </h3>
            {me && <p className="muted small">Budgets are household-wide, so they're hidden in Just me.</p>}
            {s && lines.length === 0 && (
              <p className="muted">
                No spending yet this month.{!me && <> <Link to={`/budgets?month=${month}`}>Set budgets</Link></>}
              </p>
            )}
            <ul className="bars">
              {lines.map((line) => {
                const actual = Number(line.actual);
                const budget = !me && line.budget && Number(line.budget) > 0 ? Number(line.budget) : null;
                const tone = budget ? budgetTone(actual, budget) : "";
                return (
                  <li key={line.category_id}>
                    <span className="bar-label">
                      {line.parent_name} › {line.sub_name}
                    </span>
                    {budget ? (
                      <Meter ratio={actual / budget} />
                    ) : me ? (
                      <Meter ratio={Math.max(actual, 0) / largest} tone="neutral" />
                    ) : (
                      <Meter ratio={1} tone="muted" />
                    )}
                    <span className="bar-value">
                      <Amounts>{money(actual)}</Amounts>
                      {budget !== null && <small> / <Amounts>{money(budget)}</Amounts></small>}
                      {budget !== null && tone === "over" && <small className="bar-over">over by <Amounts>{money(actual - budget)}</Amounts></small>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="card">
            <h3>Saved per month</h3>
            {trend.data && (
              <TrendChart points={trend.data} label={`Money saved per month, ${me ? "just me" : "household"}`} />
            )}
          </div>
        </div>
      </section>

      <FinancialOverview month={month} scope={scope} />
    </section>
  );
}
