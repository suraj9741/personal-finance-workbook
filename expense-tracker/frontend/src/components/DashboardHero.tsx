import { Amounts } from "./Amounts";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type MonthStats, type Overview } from "../api";
import { budgetSplit, budgetTone, currentMonth, money, monthLabel, percent, minusMoney } from "../format";
import { Meter } from "./Meter";

function Skeleton() {
  return (
    <>
      <span className="skeleton" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </>
  );
}

/**
 * The month at a glance: three big numbers, the smaller figures under them, and how they add up.
 * Spent and Saved follow the Household / Just me switch (stats); Net cash is always household
 * (overview balances, as of today).
 */
export function DashboardHero({ month, stats }: { month: string; stats: UseQueryResult<MonthStats> }) {
  // Same key as useOverview in FinancialOverview, so one request. The old month stays (dimmed) while the next loads.
  const overview = useQuery({
    queryKey: ["overview", month],
    queryFn: () => api<Overview>(`/stats/overview?month=${month}`),
    placeholderData: keepPreviousData,
  });
  const s = stats.data ?? undefined;
  const o = overview.data?.totals ? overview.data : undefined;
  // Read the scope off the data, so labels always match the numbers shown (old ones stay while the next scope loads).
  const me = s?.scope === "me";
  const busy = stats.isPlaceholderData || overview.isPlaceholderData;

  const netCash = o ? Number(o.totals.net_cash) : 0;
  const cardDues = o ? Number(o.totals.card_outstanding) : 0;
  const noAccounts = o?.accounts.length === 0;

  const spent = s ? Number(s.spend) : 0;
  const budget = budgetSplit(s?.categories ?? []).spend;
  const tone = budgetTone(spent, budget);
  const saved = s ? Number(s.saved) : 0;
  const income = s ? Number(s.income) : 0;

  return (
    <section id="dash-glance" className="dash-glance" aria-labelledby="glance-h" aria-busy={busy || undefined}>
      <h2 id="glance-h" className="sr-only">
        {monthLabel(month)} at a glance{me ? ", just me" : ", household"}
      </h2>
      {stats.isError && <p className="error">Couldn't load this month's figures: {stats.error.message}</p>}
      <dl className="hero">
        <div className={`hero-item ${o && !noAccounts && netCash < 0 ? "bad" : ""}`}>
          <dt className="hero-label">Net cash</dt>
          <dd className="hero-value">{overview.isPending ? <Skeleton /> : !o || noAccounts ? "—" : <Amounts>{minusMoney(netCash)}</Amounts>}</dd>
          {noAccounts ? (
            <dd className="hero-detail">
              <Link to="/accounts">Add accounts</Link>
            </dd>
          ) : (
            o && (
              <>
                {netCash < 0 && <dd className="hero-detail neg-text">Cards owe more than the bank holds</dd>}
                <dd className="hero-detail">
                  Bank &amp; cash <Amounts>{money(o.totals.bank_balance)}</Amounts>{" "}
                  <Amounts>{cardDues >= 0 ? `− card dues ${money(cardDues)}` : `+ card credit ${money(-cardDues)}`}</Amounts> · household, today
                  {month !== currentMonth() && `, not end of ${monthLabel(month)}`}
                </dd>
              </>
            )
          )}
        </div>

        <div className="hero-item expense">
          <dt className="hero-label">Spent this month</dt>
          <dd className="hero-value">{stats.isPending ? <Skeleton /> : <Amounts>{minusMoney(s?.spend)}</Amounts>}</dd>
          {s &&
            (me ? (
              <dd className="hero-detail">Budgets are household-wide</dd>
            ) : budget > 0 ? (
              <>
                <dd className="hero-detail">
                  of <Amounts>{money(budget)}</Amounts> budget ·{" "}
                  {tone === "over" ? <span className="neg-text"><Amounts>{money(spent - budget)}</Amounts> over budget</span> : <Amounts>{`${money(budget - spent)} left`}</Amounts>}
                </dd>
                {/* The words above say the same thing, so the meter is hidden from screen readers. */}
                <dd className="hero-meter" aria-hidden="true">
                  <Meter ratio={Math.max(spent, 0) / budget} />
                </dd>
              </>
            ) : (
              <dd className="hero-detail">
                No spending budget · <Link to={`/budgets?month=${month}`}>Set budgets</Link>
              </dd>
            ))}
        </div>

        <div className={`hero-item ${s ? (saved < 0 ? "bad" : "good") : ""}`}>
          <dt className="hero-label">Saved this month</dt>
          <dd className="hero-value">{stats.isPending ? <Skeleton /> : <Amounts>{minusMoney(s?.saved)}</Amounts>}</dd>
          {s && saved < 0 && <dd className="hero-detail neg-text">Spent <Amounts>{money(-saved)}</Amounts> more than came in</dd>}
          {s && <dd className="hero-detail"><Amounts>{income > 0 ? `${percent(s.savings_rate)} of income ${money(income)}` : "No income recorded"}</Amounts></dd>}
        </div>
      </dl>

      <dl className="figures">
        <div>
          <dt>Income</dt>
          <dd className="pos-text"><Amounts>{money(s?.income)}</Amounts></dd>
        </div>
        <div>
          <dt>Savings rate</dt>
          <dd>{percent(s?.savings_rate ?? null)}</dd>
        </div>
        <div>
          <dt>Invested</dt>
          <dd><Amounts>{money(s?.invested)}</Amounts></dd>
        </div>
        <div>
          <dt>Lent</dt>
          <dd><Amounts>{money(s?.lent)}</Amounts></dd>
        </div>
        <div>
          <dt>Repaid to you</dt>
          <dd><Amounts>{money(s?.repaid)}</Amounts></dd>
        </div>
      </dl>
      {/* The account tables count every entry by type and are household-wide; these sums say how that relates. */}
      <p className="figures-note">
        Transfers between your accounts aren't counted.
        {s && o && !me && (
          <>
            {" "}
            All expense entries: <Amounts>{money(o.totals.month_expenses)}</Amounts> = spent + invested + lent. All income entries:{" "}
            <Amounts>{money(o.totals.month_income)}</Amounts> = income + repaid.
          </>
        )}
        {me && " The account figures below are for the whole household."}
      </p>
    </section>
  );
}
