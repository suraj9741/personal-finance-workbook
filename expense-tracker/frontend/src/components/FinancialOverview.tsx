import { Link } from "react-router-dom";
import type { AccountFigures, Overview } from "../api";
import { GROUP_ICON, groupOf, money } from "../format";
import { useOverview } from "../hooks";
import { Kpi } from "./Kpi";

const sum = (rows: AccountFigures[], pick: (r: AccountFigures) => string | null) =>
  rows.reduce((total, r) => total + Number(pick(r) ?? 0), 0);

/** Active accounts, plus inactive ones that had activity this month (history stays visible). */
function shown(overview: Overview, group: "bank" | "credit_card" | "share_broker") {
  return overview.accounts.filter(
    (r) =>
      groupOf(r.account.pay_type) === group &&
      (r.account.is_active ||
        [r.month_income, r.month_expenses, r.month_transfers_in, r.month_transfers_out, r.month_buys, r.month_sells].some(
          (v) => Number(v) !== 0,
        )),
  );
}

function AccountLink({ row }: { row: AccountFigures }) {
  return (
    <Link to={`/accounts/${row.account.id}`}>
      {row.account.name}
      {row.account.pay_type === "cash" && <small className="tag">cash</small>}
      {!row.account.is_active && <small className="tag">inactive</small>}
    </Link>
  );
}

function Signed({ value }: { value: string | number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const n = Number(value);
  return <span className={n < 0 ? "neg-text" : n > 0 ? "pos-text" : ""}>{n > 0 ? "+" : ""}{money(n)}</span>;
}

/** Where all the money is: cards for totals, then a table per account type. */
export function FinancialOverview({ month }: { month: string }) {
  const overview = useOverview(month);
  if (overview.isLoading) return <p className="muted">Loading accounts…</p>;
  if (overview.isError) return <p className="error">Couldn't load the account overview: {overview.error.message}</p>;
  const data = overview.data;
  if (!data?.accounts) return null;
  if (data.accounts.length === 0)
    return (
      <div className="card">
        <p>
          No accounts yet. <Link to="/accounts">Add your bank accounts, cards and brokers</Link> to see your overall position.
        </p>
      </div>
    );
  const t = data.totals;
  const banks = shown(data, "bank");
  const cards = shown(data, "credit_card");
  const brokers = shown(data, "share_broker");

  return (
    <section className="overview" aria-label="Financial overview">
      <h2 className="section-title">Financial overview</h2>
      <div className="kpis">
        <Kpi label="Total bank balance" value={money(t.bank_balance)} note="Active bank and cash accounts" />
        <Kpi label="Credit card outstanding" value={money(t.card_outstanding)} note="Owed on active cards" />
        <Kpi
          label="Available credit"
          value={money(t.available_credit)}
          note={t.available_credit === null ? "No card has a credit limit set" : "Not cash: limit minus outstanding"}
        />
        <Kpi label="Net cash position" value={money(t.net_cash)} tone={Number(t.net_cash) < 0 ? "bad" : "good"} note="Bank balance minus card outstanding" />
        <Kpi label="Invested (at cost)" value={money(t.invested)} note={`Broker cash not invested: ${money(t.broker_cash)}`} />
        <Kpi
          label="Portfolio value"
          value={t.portfolio_value === null ? "Not valued" : money(t.portfolio_value)}
          note={
            t.brokers === 0
              ? "No broker accounts"
              : t.portfolio_value === null
                ? `${t.brokers_valued} of ${t.brokers} brokers have a value entered`
                : "From values you entered"
          }
        />
        <Kpi label="Income this month" value={money(t.month_income)} note="Income entries on all accounts" />
        <Kpi label="Expenses this month" value={money(t.month_expenses)} note="Less refunds. Transfers excluded." />
      </div>

      <div className="card">
        <h2>
          <span aria-hidden="true">{GROUP_ICON.bank}</span> Bank accounts
        </h2>
        {banks.length === 0 ? (
          <p className="muted">No bank accounts.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bank account</th>
                  <th className="num">Opening balance</th>
                  <th className="num">Current balance</th>
                  <th className="num">Income (month)</th>
                  <th className="num">Expenses (month)</th>
                </tr>
              </thead>
              <tbody>
                {banks.map((r) => (
                  <tr key={r.account.id}>
                    <td><AccountLink row={r} /></td>
                    <td className="num">{money(r.account.opening_balance)}</td>
                    <td className={`num ${Number(r.balance) < 0 ? "expense" : ""}`}>{money(r.balance)}</td>
                    <td className="num">{money(r.month_income)}</td>
                    <td className="num">{money(r.month_expenses)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th />
                  <th className="num">{money(t.bank_balance)}</th>
                  <th className="num">{money(sum(banks, (r) => r.month_income))}</th>
                  <th className="num">{money(sum(banks, (r) => r.month_expenses))}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>
          <span aria-hidden="true">{GROUP_ICON.credit_card}</span> Credit cards
        </h2>
        {cards.length === 0 ? (
          <p className="muted">No credit cards.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Credit card</th>
                    <th className="num">Credit limit</th>
                    <th className="num">Outstanding</th>
                    <th className="num">Available credit</th>
                    <th className="num">Purchases (month)</th>
                    <th className="num">Payments (month)</th>
                    <th>Due date</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((r) => (
                    <tr key={r.account.id}>
                      <td><AccountLink row={r} /></td>
                      <td className="num">{money(r.account.credit_limit)}</td>
                      <td className="num">{money(r.outstanding)}</td>
                      <td className="num">{money(r.available_credit)}</td>
                      <td className="num">{money(r.month_expenses)}</td>
                      <td className="num">{money(r.month_transfers_in)}</td>
                      <td>
                        {r.next_due_date ?? <span className="muted">Not set</span>}
                        {r.account.statement_day && <small className="muted"> · statement on day {r.account.statement_day}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th />
                    <th className="num">{money(t.card_outstanding)}</th>
                    <th className="num">{money(t.available_credit)}</th>
                    <th className="num">{money(sum(cards, (r) => r.month_expenses))}</th>
                    <th className="num">{money(sum(cards, (r) => r.month_transfers_in))}</th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted small">
              Available credit is what you can still borrow, not money you have. Purchases are less refunds; payments are
              transfers into the card.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>
          <span aria-hidden="true">{GROUP_ICON.share_broker}</span> Share market brokers
        </h2>
        {brokers.length === 0 ? (
          <p className="muted">No broker accounts.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Broker</th>
                    <th className="num">Deposited</th>
                    <th className="num">Withdrawn</th>
                    <th className="num">Cash in account</th>
                    <th className="num">Invested (cost)</th>
                    <th className="num">Current value</th>
                    <th className="num">Unrealized P/L</th>
                    <th className="num">Realized P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {brokers.map((r) => (
                    <tr key={r.account.id}>
                      <td><AccountLink row={r} /></td>
                      <td className="num">{money(r.deposited)}</td>
                      <td className="num">{money(r.withdrawn)}</td>
                      <td className="num">{money(r.balance)}</td>
                      <td className="num">{money(r.invested)}</td>
                      <td className="num">
                        {r.current_value === null ? <span className="muted">Not entered</span> : money(r.current_value)}
                        {r.account.valued_on && <small className="muted"> · {r.account.valued_on}</small>}
                      </td>
                      <td className="num"><Signed value={r.unrealized_pl} /></td>
                      <td className="num">
                        <Signed value={r.realized_pl} />
                        {!r.realized_complete && <small className="muted" title="Some sells have no cost entered"> (partial)</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th />
                    <th />
                    <th className="num">{money(t.broker_cash)}</th>
                    <th className="num">{money(t.invested)}</th>
                    <th className="num">{t.portfolio_value === null ? "—" : money(t.portfolio_value)}</th>
                    <th className="num">
                      {t.portfolio_value === null ? "—" : <Signed value={Number(t.portfolio_value) - Number(t.invested)} />}
                    </th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted small">
              No live prices: current value is only what you enter on the account. Money moved into a broker is cash until you
              record a buy.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
