import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Account, AccountFigures } from "../api";
import { AccountForm } from "../components/AccountForm";
import { Modal } from "../components/Modal";
import { ACCOUNT_GROUPS, GROUP_ICON, GROUP_PLURAL, currentMonth, groupOf, money, type AccountGroup } from "../format";
import { useMe, useOverview } from "../hooks";

/** All accounts grouped by type (bank, card, broker), with their current figures. */
export function Accounts() {
  const [params, setParams] = useSearchParams();
  const only = params.get("type") as AccountGroup | null;
  const me = useMe().data;
  const overview = useOverview(currentMonth());
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Account | AccountGroup | null>(null);

  const rows = overview.data?.accounts ?? [];
  const needle = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (showInactive || r.account.is_active) &&
      (!needle || `${r.account.name} ${r.account.institution ?? ""}`.toLowerCase().includes(needle)),
  );
  const groups = only && ACCOUNT_GROUPS.includes(only) ? [only] : ACCOUNT_GROUPS;
  const canManage = (a: Account) => (a.visibility === "private" ? a.owner_user_id === me?.id : me?.role === "owner");

  function setType(value: AccountGroup | "") {
    const next = new URLSearchParams(params);
    if (value) next.set("type", value);
    else next.delete("type");
    setParams(next, { replace: true });
  }

  return (
    <section className="accounts">
      <div className="toolbar">
        <h1>Accounts</h1>
        <button type="button" className="primary" onClick={() => setEditing(only ?? "bank")}>
          Add account
        </button>
      </div>
      <nav className="segmented wrap" aria-label="Account types">
        <button type="button" className={!only ? "active" : ""} aria-pressed={!only} onClick={() => setType("")}>
          All
        </button>
        {ACCOUNT_GROUPS.map((g) => (
          <button key={g} type="button" className={only === g ? "active" : ""} aria-pressed={only === g} onClick={() => setType(g)}>
            <span aria-hidden="true">{GROUP_ICON[g]}</span> {GROUP_PLURAL[g]}
          </button>
        ))}
      </nav>
      <div className="filters">
        <input type="search" placeholder="Search accounts" aria-label="Search accounts" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>
      {overview.isLoading && <p className="muted">Loading accounts…</p>}
      {overview.isError && <p className="error">Couldn't load accounts: {overview.error.message}</p>}
      {overview.isSuccess && rows.length === 0 && (
        <div className="card">
          <p>No accounts yet. Add your bank accounts, credit cards and broker accounts to see balances and record entries against them.</p>
          <button type="button" className="primary" onClick={() => setEditing("bank")}>
            Add your first account
          </button>
        </div>
      )}
      {overview.isSuccess &&
        rows.length > 0 &&
        groups.map((g) => {
          const items = visible.filter((r) => groupOf(r.account.pay_type) === g);
          const total = rows.filter((r) => groupOf(r.account.pay_type) === g && r.account.is_active).length;
          return (
            <div className="card" key={g}>
              <h2>
                <span aria-hidden="true">{GROUP_ICON[g]}</span> {GROUP_PLURAL[g]} <small className="muted">({total} active)</small>
              </h2>
              {items.length === 0 ? (
                <p className="muted">
                  {needle ? "No match." : `No ${GROUP_PLURAL[g].toLowerCase()} yet.`}{" "}
                  <button type="button" className="ghost small" onClick={() => setEditing(g)}>
                    Add one
                  </button>
                </p>
              ) : (
                <ul className="plain account-list">
                  {items.map((r) => (
                    <li key={r.account.id} className="row">
                      <span className={r.account.is_active ? "" : "muted"}>
                        <Link to={`/accounts/${r.account.id}`}>
                          <strong>{r.account.name}</strong>
                        </Link>
                        {r.account.pay_type === "cash" && <small className="tag">cash</small>}
                        {r.account.institution && <small className="muted"> · {r.account.institution}</small>}
                        {r.account.visibility === "private" && <small className="tag">private</small>}
                        {!r.account.is_active && <small className="tag">inactive</small>}
                      </span>
                      <KeyFigure row={r} />
                      {canManage(r.account) && (
                        <button type="button" className="ghost small" onClick={() => setEditing(r.account)}>
                          Edit
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      {editing && (
        <Modal title={typeof editing === "string" ? "Add account" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <AccountForm
            existing={typeof editing === "string" ? undefined : editing}
            group={typeof editing === "string" ? editing : undefined}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
    </section>
  );
}

/** Balance for banks, outstanding and available credit for cards, invested/value for brokers. */
export function KeyFigure({ row }: { row: AccountFigures }) {
  const group = groupOf(row.account.pay_type);
  if (group === "credit_card")
    return (
      <span className="num">
        {money(row.outstanding)} <small className="muted">owed</small>
        {row.available_credit !== null && (
          <small className="muted"> · {money(row.available_credit)} available credit</small>
        )}
      </span>
    );
  if (group === "share_broker")
    return (
      <span className="num">
        {money(row.invested)} <small className="muted">invested</small>
        {row.current_value !== null ? (
          <small className="muted"> · worth {money(row.current_value)}</small>
        ) : (
          <small className="muted"> · no value entered</small>
        )}
      </span>
    );
  return <span className={`num ${Number(row.balance) < 0 ? "expense" : ""}`}>{money(row.balance)}</span>;
}
