import { Amounts } from "./Amounts";
import { Link } from "react-router-dom";
import type { AccountFigures, Overview } from "../api";
import { GROUP_ICON, currentMonth, dayLabel, dayRange, groupOf, money, monthName, paise, today } from "../format";
import { useOverview } from "../hooks";
import { Kpi } from "./Kpi";
import { Icon } from "./Icon";

/** Money you hold: green above zero, red below, plain at zero. */
const balanceTone = (value: string) => (Number(value) > 0 ? "good" : Number(value) < 0 ? "bad" : undefined);

const sum = (rows: AccountFigures[], pick: (r: AccountFigures) => string | null) =>
  paise(rows.reduce((total, r) => total + Number(pick(r) ?? 0), 0));

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

/** A card's bill for the month: its statement when it has a statement day, else the calendar month. */
const statementOf = (r: AccountFigures) => r.statement_purchases ?? r.month_expenses;
const paymentsOf = (r: AccountFigures) => r.statement_payments ?? r.month_transfers_in;

/** The dates under a card's statement figure, so it's clear which bill it is. */
function StatementDates({ row }: { row: AccountFigures }) {
  const now = today();
  if (!row.statement_start || !row.statement_end) return <small className="cell-note">Calendar month · no statement day</small>;
  return (
    <small className="cell-note">
      {dayRange(row.statement_start, row.statement_end, now)}
      {row.statement_end >= now && " · so far"}
    </small>
  );
}

/** The account's name opens it, and so does the rest of its row (a stretched link, as on Accounts). */
function AccountLink({ row }: { row: AccountFigures }) {
  return (
    <>
      <Link className="row-link" to={`/accounts/${row.account.id}`}>
        {row.account.name}
      </Link>
      {row.account.pay_type === "cash" && <small className="tag">cash</small>}
      {!row.account.is_active && <small className="tag">inactive</small>}
    </>
  );
}

/** The › at the end of an account row; head and total rows get an empty cell to keep columns. */
const Chevron = () => (
  <td className="row-chevron">
    <Icon name="chevron-right" />
  </td>
);

function Signed({ value }: { value: string | number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const n = Number(value);
  return <span className={n < 0 ? "neg-text" : n > 0 ? "pos-text" : ""}>{n > 0 ? "+" : ""}<Amounts>{money(n)}</Amounts></span>;
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
  const current = month === currentMonth();

  return (
    <section className="overview" aria-label="Financial overview">
      <h2 className="section-title">Financial overview</h2>
      <div className="kpis">
        <Kpi
          label="Total bank balance"
          value={money(t.bank_balance)}
          note="Active bank and cash accounts"
          tone={balanceTone(t.bank_balance)}
        />
        <Kpi
          label="Credit card outstanding"
          value={money(t.card_outstanding)}
          note={t.available_credit === null ? "Owed on active cards" : `${money(t.available_credit)} of limits still available, not cash`}
        />
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
      </div>

      <div className="card">
        <h3>
          <Icon name={GROUP_ICON.bank} className="icon-heading" /> Bank accounts
        </h3>
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
                  <th className="num">All income (month)</th>
                  <th className="num">All expenses (month)</th>
                  <th className="row-chevron" />
                </tr>
              </thead>
              <tbody>
                {banks.map((r) => (
                  <tr key={r.account.id} className="link-row">
                    <td><AccountLink row={r} /></td>
                    <td data-label="Opening balance" className="num"><Amounts>{money(r.account.opening_balance)}</Amounts></td>
                    <td data-label="Current balance" className={`num ${Number(r.balance) < 0 ? "expense" : ""}`}><Amounts>{money(r.balance)}</Amounts></td>
                    <td data-label="All income (month)" className="num"><Amounts>{money(r.month_income)}</Amounts></td>
                    <td data-label="All expenses (month)" className="num"><Amounts>{money(r.month_expenses)}</Amounts></td>
                    <Chevron />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th />
                  <th data-label="Current balance" className="num"><Amounts>{money(t.bank_balance)}</Amounts></th>
                  <th data-label="All income (month)" className="num"><Amounts>{money(sum(banks, (r) => r.month_income))}</Amounts></th>
                  <th data-label="All expenses (month)" className="num"><Amounts>{money(sum(banks, (r) => r.month_expenses))}</Amounts></th>
                  <th className="row-chevron" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {banks.length > 0 && (
          <p className="muted small">All income and all expenses count every entry on the account, including savings and lending.</p>
        )}
      </div>

      <div className="card">
        <h3>
          <Icon name={GROUP_ICON.credit_card} className="icon-heading" /> Credit cards
        </h3>
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
                    <th className="num">{monthName(month)} statement</th>
                    <th className="num">
                      Payments<small className="cell-note">same dates</small>
                    </th>
                    {current && (
                      <th className="num">
                        Unbilled<small className="cell-note">since statement</small>
                      </th>
                    )}
                    <th>Due date</th>
                    <th className="row-chevron" />
                  </tr>
                </thead>
                <tbody>
                  {cards.map((r) => (
                    <tr key={r.account.id} className="link-row">
                      <td><AccountLink row={r} /></td>
                      <td data-label="Credit limit" className="num"><Amounts>{money(r.account.credit_limit)}</Amounts></td>
                      <td data-label="Outstanding" className="num"><Amounts>{money(r.outstanding)}</Amounts></td>
                      <td data-label="Available credit" className="num"><Amounts>{money(r.available_credit)}</Amounts></td>
                      <td data-label={`${monthName(month)} statement`} className="num">
                        <Amounts>{money(statementOf(r))}</Amounts>
                        <StatementDates row={r} />
                      </td>
                      <td data-label="Payments" className="num"><Amounts>{money(paymentsOf(r))}</Amounts></td>
                      {current && (
                        <td data-label="Unbilled" className="num">
                          <Amounts>{money(r.unbilled)}</Amounts>
                          {r.unbilled_since && <small className="cell-note">{dayLabel(r.unbilled_since)} – today</small>}
                        </td>
                      )}
                      <td data-label="Due date">
                        {r.next_due_date ?? <span className="muted">Not set</span>}
                      </td>
                      <Chevron />
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th />
                    <th data-label="Outstanding" className="num"><Amounts>{money(t.card_outstanding)}</Amounts></th>
                    <th data-label="Available credit" className="num"><Amounts>{money(t.available_credit)}</Amounts></th>
                    <th data-label={`${monthName(month)} statement`} className="num"><Amounts>{money(sum(cards, statementOf))}</Amounts></th>
                    <th data-label="Payments" className="num"><Amounts>{money(sum(cards, paymentsOf))}</Amounts></th>
                    {current && <th data-label="Unbilled" className="num"><Amounts>{money(sum(cards, (r) => r.unbilled))}</Amounts></th>}
                    <th />
                    <th className="row-chevron" />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted small">
              Available credit is what you can still borrow, not money you have. Each statement runs to the card's own
              statement day, so the totals cover different dates per card; an entry the bank posted later counts on the bill
              it was posted to. Statements are purchases less refunds; payments are transfers into the card.
              {current && " Unbilled is what's on the next bill so far."}
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h3>
          <Icon name={GROUP_ICON.share_broker} className="icon-heading" /> Share market brokers
        </h3>
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
                    <th className="row-chevron" />
                  </tr>
                </thead>
                <tbody>
                  {brokers.map((r) => (
                    <tr key={r.account.id} className="link-row">
                      <td><AccountLink row={r} /></td>
                      <td data-label="Deposited" className="num"><Amounts>{money(r.deposited)}</Amounts></td>
                      <td data-label="Withdrawn" className="num"><Amounts>{money(r.withdrawn)}</Amounts></td>
                      <td data-label="Cash in account" className="num"><Amounts>{money(r.balance)}</Amounts></td>
                      <td data-label="Invested (cost)" className="num"><Amounts>{money(r.invested)}</Amounts></td>
                      <td data-label="Current value" className="num">
                        {r.current_value === null ? <span className="muted">Not entered</span> : <Amounts>{money(r.current_value)}</Amounts>}
                        {r.account.valued_on && <small className="muted"> · {r.account.valued_on}</small>}
                      </td>
                      <td data-label="Unrealized P/L" className="num"><Signed value={r.unrealized_pl} /></td>
                      <td data-label="Realized P/L" className="num">
                        <Signed value={r.realized_pl} />
                        {!r.realized_complete && <small className="muted" title="Some sells have no cost entered"> (partial)</small>}
                      </td>
                      <Chevron />
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th />
                    <th />
                    <th data-label="Cash in account" className="num"><Amounts>{money(t.broker_cash)}</Amounts></th>
                    <th data-label="Invested (cost)" className="num"><Amounts>{money(t.invested)}</Amounts></th>
                    <th data-label="Current value" className="num"><Amounts>{t.portfolio_value === null ? "—" : money(t.portfolio_value)}</Amounts></th>
                    <th data-label="Unrealized P/L" className="num">
                      {t.portfolio_value === null ? "—" : <Signed value={Number(t.portfolio_value) - Number(t.invested)} />}
                    </th>
                    <th />
                    <th className="row-chevron" />
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
