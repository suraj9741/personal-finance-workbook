import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { api, type YearStats } from "../api";
import { dayLabel, minusMoney, money, monthName, percent } from "../format";
import { Amounts } from "./Amounts";
import { Icon } from "./Icon";
import { Meter } from "./Meter";
import { YearChart } from "./YearChart";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Groups listed by name in the year's categories; the rest fold into one line.
const TOP_GROUPS = 8;

const counted = (status: string) => status === "tracked" || status === "partial";

/** "January to September", or the one month's name. */
function monthSpan(months: string[]): string {
  if (months.length === 0) return "";
  const first = monthName(months[0]);
  return months.length === 1 ? first : `${first} to ${monthName(months[months.length - 1])}`;
}

function Hero({ y }: { y: YearStats }) {
  const me = y.scope === "me";
  const months = y.months.filter((m) => counted(m.status));
  const n = Math.max(months.length, 1);
  const income = Number(y.income);
  const spent = Number(y.spend);
  const saved = Number(y.saved);
  const budget = y.budget_to_date === null ? null : Number(y.budget_to_date);
  const highest = months.reduce<(typeof months)[number] | null>((best, m) => (!best || Number(m.spend) > Number(best.spend) ? m : best), null);
  return (
    <>
      <dl className="hero">
        <div className="hero-item">
          <dt className="hero-label">Income this year</dt>
          <dd className="hero-value pos-text"><Amounts>{money(y.income)}</Amounts></dd>
          <dd className="hero-detail">
            <Amounts>{income > 0 ? `about ${money(income / n)} a month` : "No income recorded yet"}</Amounts>
          </dd>
        </div>
        <div className="hero-item expense">
          <dt className="hero-label">Spent this year</dt>
          <dd className="hero-value"><Amounts>{minusMoney(y.spend)}</Amounts></dd>
          {me ? (
            <dd className="hero-detail">Budgets are household-wide</dd>
          ) : budget !== null && budget > 0 ? (
            <>
              <dd className="hero-detail">
                <Amounts>{`of ${money(budget)} budget so far · `}</Amounts>
                {spent > budget ? (
                  <span className="neg-text"><Amounts>{`${money(spent - budget)} over`}</Amounts></span>
                ) : (
                  <Amounts>{`${money(budget - spent)} left`}</Amounts>
                )}
              </dd>
              <dd className="hero-meter" aria-hidden="true">
                <Meter ratio={Math.max(spent, 0) / budget} />
              </dd>
            </>
          ) : (
            <dd className="hero-detail">No spending budget</dd>
          )}
        </div>
        <div className={`hero-item ${saved < 0 ? "bad" : "good"}`}>
          <dt className="hero-label">Saved this year</dt>
          <dd className="hero-value"><Amounts>{minusMoney(y.saved)}</Amounts></dd>
          <dd className="hero-detail">
            <Amounts>{income > 0 ? `${percent(y.savings_rate)} of income ${money(income)}` : "No income yet, so no savings rate"}</Amounts>
          </dd>
        </div>
      </dl>
      <dl className="figures">
        <div>
          <dt>Average spend a month</dt>
          <dd><Amounts>{money(spent / n)}</Amounts></dd>
        </div>
        <div>
          <dt>Highest month</dt>
          <dd>{highest && Number(highest.spend) > 0 ? <Amounts>{`${SHORT[Number(highest.month.slice(5)) - 1]} · ${money(highest.spend)}`}</Amounts> : "—"}</dd>
        </div>
        <div>
          <dt>Invested</dt>
          <dd><Amounts>{money(y.invested)}</Amounts></dd>
        </div>
        <div>
          <dt>Lent</dt>
          <dd><Amounts>{money(y.lent)}</Amounts></dd>
        </div>
        <div>
          <dt>Repaid to you</dt>
          <dd><Amounts>{money(y.repaid)}</Amounts></dd>
        </div>
      </dl>
      <p className="figures-note">
        Transfers between your accounts aren't counted. Averages count only the months you tracked.
        {y.card_bills_count > 0 && (
          <>
            {" "}
            <Amounts>{`Includes ${y.card_bills_count} ${y.card_bills_count === 1 ? "entry" : "entries"} under Debt › Credit cards (${money(y.card_bills_total)}) that likely double count card spends: enter card bills as a Bank to Credit transfer.`}</Amounts>
          </>
        )}
      </p>
    </>
  );
}

function Categories({ y }: { y: YearStats }) {
  const [open, setOpen] = useState<string | null>(null);
  const spent = Math.max(Number(y.spend), 1);
  const named = y.groups.slice(0, TOP_GROUPS);
  const rest = y.groups.slice(TOP_GROUPS);
  const restTotal = rest.reduce((sum, g) => sum + Number(g.total), 0);
  const tracked = y.months.map((m) => counted(m.status));
  const n = Math.max(tracked.filter(Boolean).length, 1);
  return (
    <div className="card">
      <h3>
        Where the money went <small className="muted">· by group</small>
      </h3>
      {y.groups.length === 0 ? (
        <p className="muted">No spending this year.</p>
      ) : (
        <div className="table-wrap">
          <table className="year-groups">
            <thead>
              <tr>
                <th>Group</th>
                <th className="num">Year</th>
                <th className="num wide-only">Per month</th>
                <th className="num">Share</th>
                <th className="wide-only">
                  <span className="sr-only">Month by month</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {named.map((g) => {
                const name = g.parent_name ?? "No category";
                const isOpen = open === name;
                const peak = Math.max(1, ...g.months.map(Number));
                return (
                  <Fragment key={name}>
                    <tr className={isOpen ? "open" : undefined}>
                      <td>
                        <button type="button" className="group-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : name)}>
                          <Icon name={isOpen ? "chevron-down" : "chevron-right"} /> {name}
                        </button>
                      </td>
                      <td className="num"><Amounts>{money(g.total)}</Amounts></td>
                      <td className="num wide-only"><Amounts>{money(Number(g.total) / n)}</Amounts></td>
                      <td className="num muted">{Math.round((Number(g.total) / spent) * 100)}%</td>
                      <td className="wide-only">
                        <span className="spark" aria-hidden="true">
                          {g.months.map((v, i) => (
                            <span key={i} className={tracked[i] ? undefined : "none"} style={{ height: `${(Math.max(Number(v), 0) / peak) * 100}%` }} />
                          ))}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="group-months">
                        <td colSpan={5}>
                          <div className="group-months-grid">
                            {g.months.map((v, i) => (
                              <span key={i}>
                                {SHORT[i]}
                                <b>{tracked[i] ? <Amounts>{money(v)}</Amounts> : "—"}</b>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rest.length > 0 && (
                <tr>
                  <td className="muted">{rest.length} more {rest.length === 1 ? "group" : "groups"}</td>
                  <td className="num muted"><Amounts>{money(restTotal)}</Amounts></td>
                  <td className="num wide-only muted"><Amounts>{money(restTotal / n)}</Amounts></td>
                  <td className="num muted">{Math.round((restTotal / spent) * 100)}%</td>
                  <td className="wide-only" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Biggest({ y }: { y: YearStats }) {
  return (
    <div className="card">
      <h3>Biggest expenses</h3>
      {y.biggest.length === 0 ? (
        <p className="muted">No expenses this year.</p>
      ) : (
        <ul className="big-list">
          {y.biggest.map((e) => (
            <li key={e.id}>
              <span className="big-what">{e.description || (e.sub_name ?? "No description")}</span>
              <span className="big-amount"><Amounts>{money(e.amount)}</Amounts></span>
              <span className="big-meta">
                {[e.parent_name ? `${e.parent_name} › ${e.sub_name}` : "No category", dayLabel(e.date), e.account_name].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {y.big_count > 0 && (
        <p className="muted small big-note">
          <Amounts>{`${y.big_count} ${y.big_count === 1 ? "entry" : "entries"} of ${money(y.big_threshold)} or more: ${money(y.big_total)}, ${Math.round((Number(y.big_total) / Math.max(Number(y.spend), 1)) * 100)}% of the year's spending.`}</Amounts>
        </p>
      )}
    </div>
  );
}

function BudgetGrid({ y }: { y: YearStats }) {
  const status = y.months.map((m) => m.status);
  const n = status.filter(counted).length;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Budgets, month by month</h3>
        <span className="card-caption">% of each group's budget used · red when over</span>
      </div>
      <div className="grid-wrap">
        <table className="year-budgets">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Group</span>
              </th>
              {SHORT.map((m) => (
                <th key={m} scope="col">{m}</th>
              ))}
              <th>
                <span className="sr-only">Months over</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {y.budget_grid.map((row) => {
              let over = 0;
              const cells = row.months.map((c, i) => {
                if (!counted(status[i])) return { tone: status[i] === "untracked" ? "none" : "later", text: "", label: status[i] === "untracked" ? "not tracked" : "not started" };
                if (c.budget === null || Number(c.budget) <= 0) return { tone: "nob", text: "–", label: `${money(c.actual)}, no budget` };
                const pct = Math.round((Number(c.actual) / Number(c.budget)) * 100);
                if (pct > 100) over += 1;
                return { tone: pct > 100 ? "over" : "ok", text: String(pct), label: `${money(c.actual)} of ${money(c.budget)}` };
              });
              return (
                <tr key={row.parent_name}>
                  <th scope="row">{row.parent_name}</th>
                  {cells.map((c, i) => (
                    <td key={i} className={`cell ${c.tone}`} title={`${SHORT[i]}: ${c.label}`}>
                      {c.text}
                    </td>
                  ))}
                  <td className={`over-count ${over >= 3 ? "bad" : ""}`}>
                    over {over} of {n}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Family({ y }: { y: YearStats }) {
  const given = y.family.reduce((sum, f) => sum + Number(f.given), 0);
  const n = Math.max(y.months.filter((m) => counted(m.status)).length, 1);
  return (
    <div className="card">
      <div className="card-head">
        <h3>Family</h3>
        <span className="card-caption">
          <Amounts>{`${money(given)} spent on family this year · ${money(given / n)} a month · ${Math.round((given / Math.max(Number(y.spend), 1)) * 100)}% of all spending`}</Amounts>
        </span>
      </div>
      <ul className="family-cards">
        {y.family.map((f) => (
          <li key={f.parent_name}>
            <span className="family-name">{f.parent_name}</span>
            <span className={`family-given ${Number(f.given) > 0 ? "expense-text" : ""}`}><Amounts>{money(f.given)}</Amounts></span>
            <span className="family-line">
              <span>A month</span>
              <Amounts>{money(Number(f.given) / n)}</Amounts>
            </span>
            <span className="family-line">
              <span>Received</span>
              <Amounts>{money(f.received)}</Amounts>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small family-note">
        The big number is what you spent under each group. Money they send you is income; it's shown here only for reference. Choose the family groups in <Link to="/settings#categories">Settings</Link>.
      </p>
    </div>
  );
}

/** January to December: totals, the months side by side, where the money went, budgets and family. */
export function YearView({ year, scope }: { year: number; scope: "household" | "me" }) {
  const query = useQuery({
    queryKey: ["year", year, scope],
    queryFn: () => api<YearStats>(`/stats/year?year=${year}&scope=${scope}`),
    placeholderData: keepPreviousData,
  });
  const y = query.data;
  if (query.isError) return <p className="error">Couldn't load {year}: {query.error.message}</p>;
  if (!y) return <p className="loading">Loading…</p>;

  const untracked = y.months.filter((m) => m.status === "untracked").map((m) => m.month);
  const tracked = y.months.filter((m) => counted(m.status)).length;
  const me = y.scope === "me";
  return (
    <div id="year-view" className="year-view" aria-busy={query.isPlaceholderData || undefined}>
      <p id="scope-caption" className="hero-caption">
        {me ? "Just me" : "Household"} · January to December {y.year} ·{" "}
        {tracked === 0 ? "nothing tracked yet" : `${tracked} of 12 months tracked`}
      </p>
      {tracked > 0 && untracked.length > 0 && y.first_entry && (
        <div className="card year-banner">
          <strong>This year starts in the app on {dayLabel(y.first_entry, `${y.year}-01-01`)}.</strong>{" "}
          <span className="muted">
            {monthSpan(untracked)} {untracked.length === 1 ? "isn't" : "aren't"} in the app, so the totals cover part of the year. Averages and "over N months" count only tracked months.
          </span>
        </div>
      )}
      <section className="dash-glance" aria-label={`${y.year} at a glance`}>
        <Hero y={y} />
      </section>
      <div className="card">
        <h3>Month by month</h3>
        <YearChart months={y.months} />
      </div>

      <h2 className="section-title">The year by category</h2>
      <div className="dash-section-body">
        <Categories y={y} />
        <Biggest y={y} />
      </div>
      {!me && y.budget_grid.length > 0 && <BudgetGrid y={y} />}
      {y.family.length > 0 && <Family y={y} />}
    </div>
  );
}
