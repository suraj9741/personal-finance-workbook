import { Amounts } from "./Amounts";
import { Link } from "react-router-dom";
import type { AccountFigures, Overview } from "../api";
import { GROUP_ICON, currentMonth, dayLabel, dayRange, groupOf, money, monthName, paise, signedMoney, today } from "../format";
import { useOverview, useOwnerName } from "../hooks";
import { OwnerTag } from "./OwnerTag";
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
function AccountLink({ row, owner }: { row: AccountFigures; owner?: string }) {
  return (
    <>
      <Link className="row-link" to={`/accounts/${row.account.id}`}>
        {row.account.name}
      </Link>
      {owner && <> <OwnerTag name={owner} /></>}
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

/** Money moved in from your other accounts less money moved out to them. */
const transfersOf = (r: AccountFigures) => paise(Number(r.month_transfers_in) - Number(r.month_transfers_out));

/** "₹-…" in red when an account has gone below zero. */
const belowZero = (value: string | number | null) => (Number(value) < 0 ? "expense" : "");

function Signed({ value }: { value: string | number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const n = Number(value);
  return <span className={n < 0 ? "neg-text" : n > 0 ? "pos-text" : ""}>{n > 0 ? "+" : ""}<Amounts>{money(n)}</Amounts></span>;
}

/** Bank rows by whose they are: yours first, then each family member's shared accounts. */
function byOwner(rows: AccountFigures[], ownerOf: (r: AccountFigures) => string | undefined) {
  const groups = new Map<string, AccountFigures[]>();
  for (const r of rows) {
    const key = ownerOf(r) ?? "";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
}

/** Where all the money is: cards for totals, then a table per account type. */
export function FinancialOverview({ month, scope = "household" }: { month: string; scope?: "household" | "me" }) {
  const overview = useOverview(month, scope);
  const ownerName = useOwnerName();
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
  const ownerOf = (r: AccountFigures) => ownerName(r.account);
  const bankOwners = byOwner(banks, ownerOf);
  // Someone else's shared accounts are in view: split the bank table and its total by person.
  const split = bankOwners.length > 1;
  const activeSum = (rows: AccountFigures[], pick: (r: AccountFigures) => string | null) => sum(rows.filter((r) => r.account.is_active), pick);
  const bankNote = split
    ? bankOwners.map(([who, rows]) => `${who || "Yours"} ${money(activeSum(rows, (r) => r.balance))}`).join(" · ")
    : "Active bank and cash accounts";
  const cards = shown(data, "credit_card");
  const brokers = shown(data, "share_broker");
  const current = month === currentMonth();
  const short = monthName(month).slice(0, 3);
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = `${month}-${new Date(year, monthNumber, 0).getDate()}`;

  return (
    <section className="overview" aria-label="Financial overview">
      <h2 className="section-title">Financial overview</h2>
      <div className="kpis">
        <Kpi
          label="Total bank balance"
          value={money(t.bank_balance)}
          note={bankNote}
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
                  <th className="num">
                    Start of {short}<small className="cell-note">{dayLabel(`${month}-01`)}</small>
                  </th>
                  <th className="num">Income</th>
                  <th className="num">Expenses</th>
                  <th className="num">
                    Transfers<small className="cell-note">in − out</small>
                  </th>
                  <th className="num">
                    End of {short}<small className="cell-note">{dayLabel(lastDay)}</small>
                  </th>
                  <th className="num today-col">
                    Current balance<small className="cell-note">today, {dayLabel(today())}</small>
                  </th>
                  <th className="row-chevron" />
                </tr>
              </thead>
              {bankOwners.map(([who, rows]) => (
              <tbody key={who || "mine"}>
                {split && (
                  <tr className="overview-owner">
                    <th colSpan={8} scope="rowgroup">
                      {who ? <OwnerTag name={who} /> : "Your accounts"}
                      {who && <span className="muted">shared with you · view only</span>}
                    </th>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.account.id} className="link-row">
                    {/* Under a person's heading the name already says whose it is. */}
                    <td><AccountLink row={r} owner={split ? undefined : ownerOf(r)} /></td>
                    <td data-label={`Start of ${short}`} className={`num ${belowZero(r.balance_month_start)}`}><Amounts>{money(r.balance_month_start)}</Amounts></td>
                    <td data-label="Income" className="num"><Amounts>{money(r.month_income)}</Amounts></td>
                    <td data-label="Expenses" className="num"><Amounts>{money(r.month_expenses)}</Amounts></td>
                    <td data-label="Transfers" className="num"><Amounts>{signedMoney(transfersOf(r))}</Amounts></td>
                    <td data-label={`End of ${short}`} className={`num ${belowZero(r.balance_month_end)}`}><Amounts>{money(r.balance_month_end)}</Amounts></td>
                    <td data-label="Current balance" className={`num today-col ${belowZero(r.balance)}`}><Amounts>{money(r.balance)}</Amounts></td>
                    <Chevron />
                  </tr>
                ))}
                {split && (
                  <tr className="overview-subtotal">
                    <td>{who ? `${who}'s total` : "Your total"}</td>
                    <td data-label={`Start of ${short}`} className="num"><Amounts>{money(activeSum(rows, (r) => r.balance_month_start))}</Amounts></td>
                    <td data-label="Income" className="num"><Amounts>{money(sum(rows, (r) => r.month_income))}</Amounts></td>
                    <td data-label="Expenses" className="num"><Amounts>{money(sum(rows, (r) => r.month_expenses))}</Amounts></td>
                    <td data-label="Transfers" className="num"><Amounts>{signedMoney(sum(rows, (r) => String(transfersOf(r))))}</Amounts></td>
                    <td data-label={`End of ${short}`} className="num"><Amounts>{money(activeSum(rows, (r) => r.balance_month_end))}</Amounts></td>
                    <td data-label="Current balance" className="num today-col"><Amounts>{money(activeSum(rows, (r) => r.balance))}</Amounts></td>
                    <td className="row-chevron" />
                  </tr>
                )}
              </tbody>
              ))}
              <tfoot>
                <tr>
                  <th>{split ? "Household total" : "Total"}</th>
                  <th data-label={`Start of ${short}`} className="num"><Amounts>{money(t.bank_balance_month_start)}</Amounts></th>
                  <th data-label="Income" className="num"><Amounts>{money(sum(banks, (r) => r.month_income))}</Amounts></th>
                  <th data-label="Expenses" className="num"><Amounts>{money(sum(banks, (r) => r.month_expenses))}</Amounts></th>
                  <th data-label="Transfers" className="num"><Amounts>{signedMoney(sum(banks, (r) => String(transfersOf(r))))}</Amounts></th>
                  <th data-label={`End of ${short}`} className="num"><Amounts>{money(t.bank_balance_month_end)}</Amounts></th>
                  <th data-label="Current balance" className="num today-col"><Amounts>{money(t.bank_balance)}</Amounts></th>
                  <th className="row-chevron" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {banks.length > 0 && (
          <p className="muted small">
            Each row adds up: start + income − expenses ± transfers = end of {monthName(month)}, counting entries already
            dated later in the month. Current balance counts entries up to today. Income and expenses count every entry on
            the account, including savings and lending; transfers between your own banks cancel out in the total. Each
            account's fixed opening balance is on its own page.
          </p>
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
                      <td><AccountLink row={r} owner={ownerOf(r)} /></td>
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
                      <td><AccountLink row={r} owner={ownerOf(r)} /></td>
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
