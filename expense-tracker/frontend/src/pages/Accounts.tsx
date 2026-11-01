import { Amounts } from "../components/Amounts";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Account, AccountFigures, Overview } from "../api";
import { AccountForm } from "../components/AccountForm";
import { AccountMark } from "../components/AccountMark";
import { Modal } from "../components/Modal";
import { useToasts } from "../components/toast-context";
import {
  ACCOUNT_GROUPS,
  GROUP_ICON,
  GROUP_PLURAL,
  GROUP_SHORT,
  currentMonth,
  groupOf,
  money,
  signedMoney,
  signedPercent,
  type AccountGroup,
} from "../format";
import { ownsAccount, useMe, useOverview, useOwnerName } from "../hooks";
import { OwnerTag } from "../components/OwnerTag";
import { Icon } from "../components/Icon";
import { SegmentedRadio } from "../components/SegmentedRadio";

/** The search box only shows once there are more accounts than fit at a glance. */
const SEARCH_FROM = 8;

const ADD_LABEL: Record<AccountGroup, string> = {
  bank: "Add bank account",
  credit_card: "Add credit card",
  share_broker: "Add broker",
};

/** A balance in normal text; below zero it gets a real minus sign. */
const balanceText = (value: string | number | null) => (Number(value ?? 0) < 0 ? signedMoney(Number(value)) : money(value ?? 0));

/** What a group adds up to: banks' balance, what cards owe, what brokers hold. */
function groupTotal(group: AccountGroup, totals: Overview["totals"]): string {
  if (group === "bank") return balanceText(totals.bank_balance);
  if (group === "credit_card") {
    const owed = Number(totals.card_outstanding);
    return owed < 0 ? `${money(-owed)} in credit` : `${money(owed)} owed`;
  }
  const valued = totals.brokers > 0 && totals.brokers_valued === totals.brokers && totals.portfolio_value !== null;
  return valued ? `worth ${money(totals.portfolio_value)}` : `${money(totals.invested)} invested`;
}

/** All accounts grouped by type (bank, card, broker), with their current figures. */
export function Accounts() {
  const [params, setParams] = useSearchParams();
  const only = params.get("type") as AccountGroup | null;
  const me = useMe().data;
  const ownerName = useOwnerName();
  const overview = useOverview(currentMonth());
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Account | AccountGroup | null>(null);
  const { hidden } = useToasts();

  const rows = (overview.data?.accounts ?? []).filter((r) => !hidden.has(r.account.id));
  const searchable = rows.length > SEARCH_FROM;
  const needle = searchable ? search.trim().toLowerCase() : "";
  // Inactive accounts sit at the bottom of their group (sort is stable, so the rest keep their order).
  const visible = rows
    .filter(
      (r) =>
        (showInactive || r.account.is_active) &&
        (!needle || `${r.account.name} ${r.account.institution ?? ""}`.toLowerCase().includes(needle)),
    )
    // Yours first, then family members' shared accounts; inactive ones last.
    .sort((a, b) => Number(b.account.is_active) - Number(a.account.is_active) || Number(!!ownerName(a.account)) - Number(!!ownerName(b.account)));
  const groups = only && ACCOUNT_GROUPS.includes(only) ? [only] : ACCOUNT_GROUPS;
  // While searching, groups with no match step aside.
  const shown = needle ? groups.filter((g) => visible.some((r) => groupOf(r.account.pay_type) === g)) : groups;
  const canManage = (a: Account) => ownsAccount(a, me);

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
        <button type="button" className="primary" data-return-focus onClick={() => setEditing(only ?? "bank")}>
          Add account
        </button>
      </div>
      <SegmentedRadio
        label="Show"
        className="segmented wrap"
        value={only ?? "all"}
        onChange={(v) => setType(v === "all" ? "" : v)}
        options={[{ value: "all" as const, label: "All" }, ...ACCOUNT_GROUPS.map((g) => ({ value: g, label: GROUP_SHORT[g] }))]}
      />
      {(searchable || rows.some((r) => !r.account.is_active)) && (
        <div className="filters">
          {searchable && (
            <input type="search" placeholder="Search accounts" aria-label="Search accounts" value={search} onChange={(e) => setSearch(e.target.value)} />
          )}
          {rows.some((r) => !r.account.is_active) && (
            <label className="check">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
          )}
        </div>
      )}
      {overview.isPending &&
        groups.map((g) => (
          <div className="card" key={g} aria-hidden="true">
            <span className="skeleton account-skeleton-title" />
            <ul className="account-list">
              {[0, 1].map((i) => (
                <li key={i} className="account-row account-skeleton">
                  <span className="skeleton" />
                  <span className="skeleton" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      {overview.isError && (
        <div className="card account-state">
          <p>Couldn't load accounts: {overview.error.message}</p>
          <button type="button" onClick={() => overview.refetch()}>
            Try again
          </button>
        </div>
      )}
      {overview.isSuccess && rows.length === 0 && (
        <div className="card account-state">
          <p>No accounts yet. Add one to see its balance and record entries against it.</p>
          <div className="row wrap">
            {ACCOUNT_GROUPS.map((g) => (
              <button key={g} type="button" className={g === "bank" ? "primary" : "tinted"} onClick={() => setEditing(g)}>
                {ADD_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
      )}
      {overview.isSuccess && rows.length > 0 && needle && shown.length === 0 && (
        <div className="card account-state">
          <p>No accounts match "{search.trim()}".</p>
          <button type="button" className="ghost" onClick={() => setSearch("")}>
            Clear search
          </button>
        </div>
      )}
      {overview.isSuccess &&
        rows.length > 0 &&
        shown.map((g) => {
          const items = visible.filter((r) => groupOf(r.account.pay_type) === g);
          const count = rows.filter((r) => groupOf(r.account.pay_type) === g && r.account.is_active).length;
          return (
            <div className="card" key={g}>
              <div className="account-group-head">
                <div>
                  <h2>
                    <Icon name={GROUP_ICON[g]} className="icon-heading" /> {GROUP_PLURAL[g]}
                  </h2>
                  <p className="muted small">
                    {count} {count === 1 ? "account" : "accounts"}
                  </p>
                </div>
                {count > 0 && <span className="num account-group-total"><Amounts>{groupTotal(g, overview.data.totals)}</Amounts></span>}
              </div>
              {items.length === 0 ? (
                <p className="muted account-empty">
                  No {GROUP_PLURAL[g].toLowerCase()} yet.{" "}
                  <button type="button" className="tinted small" onClick={() => setEditing(g)}>
                    {ADD_LABEL[g]}
                  </button>
                </p>
              ) : (
                <ul className="account-list">
                  {items.map((r) => (
                    <li key={r.account.id} className={r.account.is_active ? "account-row" : "account-row inactive"}>
                      <span className="account-main">
                        <AccountMark account={r.account} />
                        <Link to={`/accounts/${r.account.id}`}>{r.account.name}</Link>
                        {(r.account.institution || r.account.pay_type === "cash" || r.account.visibility === "shared" || !r.account.is_active) && (
                          <small className="account-sub">
                            <OwnerTag name={ownerName(r.account)} />
                            {r.account.institution}
                            {r.account.pay_type === "cash" && <span className="tag">Cash</span>}
                            {r.account.visibility === "shared" && !ownerName(r.account) && <span className="tag">Shared</span>}
                            {!r.account.is_active && <span className="tag">Inactive</span>}
                          </small>
                        )}
                      </span>
                      <KeyFigure row={r} />
                      {canManage(r.account) ? (
                        <button type="button" className="ghost small account-edit" aria-label={`Edit ${r.account.name}`} onClick={() => setEditing(r.account)}>
                          Edit
                        </button>
                      ) : (
                        // Same slot as Edit, so it hides with it on a phone and the chevron stays put.
                        <span className="account-edit" aria-hidden="true" />
                      )}
                      <Icon name="chevron-right" className="account-chevron" />
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

/**
 * The one figure that matters for each type, with a caption under it. Bank: the balance. Card: what's
 * owed and what's available (or "in credit"). Broker: the current value and its gain, or what went in.
 */
export function KeyFigure({ row }: { row: AccountFigures }) {
  const group = groupOf(row.account.pay_type);
  if (group === "credit_card") {
    const owed = Number(row.outstanding ?? 0);
    if (owed < 0) return <Figure value={money(-owed)} caption="in credit" />;
    return <Figure value={money(owed)} caption={row.available_credit !== null ? `owed · ${money(row.available_credit)} available` : "owed"} />;
  }
  if (group === "share_broker") {
    if (row.current_value === null) return <Figure value={money(row.invested ?? 0)} caption="invested · no value entered" />;
    const gain = Number(row.unrealized_pl ?? 0);
    const base = Number(row.invested ?? 0);
    return (
      <Figure
        value={money(row.current_value)}
        caption={base ? `${signedMoney(gain)} (${signedPercent(gain / base)})` : signedMoney(gain)}
        captionTone={gain > 0 ? "pos-text" : gain < 0 ? "neg-text" : undefined}
      />
    );
  }
  return <Figure value={balanceText(row.balance)} valueTone={Number(row.balance) < 0 ? "neg-text" : undefined} />;
}

function Figure({ value, caption, valueTone, captionTone }: { value: string; caption?: string; valueTone?: string; captionTone?: string }) {
  return (
    <span className="account-figure">
      <span className={valueTone ? `num ${valueTone}` : "num"}>
        <Amounts>{value}</Amounts>
      </span>
      {caption && (
        <small className={captionTone ?? "muted"}>
          <Amounts>{caption}</Amounts>
        </small>
      )}
    </span>
  );
}
