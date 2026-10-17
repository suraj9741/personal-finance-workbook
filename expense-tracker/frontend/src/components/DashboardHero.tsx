import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type MonthStats, type Overview } from "../api";
import { budgetSplit, budgetTone, currentMonth, money, monthLabel, percent, signedMoney } from "../format";

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
          <dd className="hero-value">{overview.isPending ? <Skeleton /> : !o || noAccounts ? "—" : signedMoney(netCash)}</dd>
          {noAccounts ? (
            <dd className="hero-detail">
              <Link to="/accounts">Add accounts</Link>
            </dd>
          ) : (
            o && (
              <>
                {netCash < 0 && <dd className="hero-detail neg-text">Cards owe more than the bank holds</dd>}
                <dd className="hero-detail">
                  Bank &amp; cash {money(o.totals.bank_balance)}{" "}
                  {cardDues >= 0 ? `− card dues ${money(cardDues)}` : `+ card credit ${money(-cardDues)}`} · household, today
                  {month !== currentMonth() && `, not end of ${monthLabel(month)}`}
                </dd>
              </>
            )
          )}
        </div>

        <div className="hero-item expense">
          <dt className="hero-label">Spent this month</dt>
          <dd className="hero-value">{stats.isPending ? <Skeleton /> : signedMoney(s?.spend)}</dd>
          {s &&
            (me ? (
              <dd className="hero-detail">Budgets are household-wide</dd>
            ) : budget > 0 ? (
              <>
                <dd className="hero-detail">
                  of {money(budget)} budget ·{" "}
                  {tone === "over" ? <span className="neg-text">{money(spent - budget)} over budget</span> : `${money(budget - spent)} left`}
                </dd>
                {/* The words above say the same thing, so the meter is hidden from screen readers. */}
                <dd className="hero-meter" aria-hidden="true">
                  <span className="bar-track">
                    <span className={`bar-fill ${tone}`} style={{ width: `${Math.min(100, (Math.max(spent, 0) / budget) * 100)}%` }} />
                  </span>
                </dd>
              </>
            ) : (
              <dd className="hero-detail">
                No spending budget · <Link to="/budgets">Set budgets</Link>
              </dd>
            ))}
        </div>

        <div className={`hero-item ${s ? (saved < 0 ? "bad" : "good") : ""}`}>
          <dt className="hero-label">Saved this month</dt>
          <dd className="hero-value">{stats.isPending ? <Skeleton /> : signedMoney(s?.saved)}</dd>
          {s && saved < 0 && <dd className="hero-detail neg-text">Spent {money(-saved)} more than came in</dd>}
          {s && <dd className="hero-detail">{income > 0 ? `${percent(s.savings_rate)} of income ${money(income)}` : "No income recorded"}</dd>}
        </div>
      </dl>

      <dl className="figures">
        <div>
          <dt>Income</dt>
          <dd className="pos-text">{money(s?.income)}</dd>
        </div>
        <div>
          <dt>Savings rate</dt>
          <dd>{percent(s?.savings_rate ?? null)}</dd>
        </div>
        <div>
          <dt>Invested</dt>
          <dd>{money(s?.invested)}</dd>
        </div>
        <div>
          <dt>Lent</dt>
          <dd>{money(s?.lent)}</dd>
        </div>
        <div>
          <dt>Repaid to you</dt>
          <dd>{money(s?.repaid)}</dd>
        </div>
      </dl>
      {/* The account tables count every entry by type and are household-wide; these sums say how that relates. */}
      <p className="figures-note">
        Transfers between your accounts aren't counted.
        {s && o && !me && (
          <>
            {" "}
            All expense entries: {money(o.totals.month_expenses)} = spent + invested + lent. All income entries:{" "}
            {money(o.totals.month_income)} = income + repaid.
          </>
        )}
        {me && " The account figures below are for the whole household."}
      </p>
    </section>
  );
}
