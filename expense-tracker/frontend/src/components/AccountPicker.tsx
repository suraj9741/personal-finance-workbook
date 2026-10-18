import { useState } from "react";
import type { Account } from "../api";
import { ACCOUNT_GROUPS, GROUP_ICON, GROUP_LABEL, accountLabel, groupOf, type AccountGroup } from "../format";
import { Icon } from "./Icon";
import { SegmentedRadio } from "./SegmentedRadio";

interface Props {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  /** Shown before "type" and "account" in labels, e.g. "From" or "To". */
  label?: string;
  /** Limit the types offered (buys and sells are on brokers only). */
  groups?: AccountGroup[];
  exclude?: string | null;
  /** "buttons": three big choices (full form). "select": two compact dropdowns (quick add). */
  variant?: "buttons" | "select";
}

/** Step 1: account type. Step 2: an account of that type. Saves the account id. */
export function AccountPicker({ accounts, value, onChange, label, groups = ACCOUNT_GROUPS, exclude, variant = "buttons" }: Props) {
  const selected = accounts.find((a) => a.id === value);
  const [chosen, setChosen] = useState<AccountGroup | null>(null);
  const group: AccountGroup = selected ? groupOf(selected.pay_type) : (chosen ?? groups[0]);
  const options = accounts.filter((a) => groupOf(a.pay_type) === group && a.id !== exclude);
  const typeLabel = label ? `${label} account type` : "Account type";
  const accountLabelText = label ? `${label} account` : "Account";

  function pick(next: AccountGroup) {
    setChosen(next);
    const first = accounts.find((a) => groupOf(a.pay_type) === next && a.id !== exclude);
    onChange(first?.id ?? "");
  }

  const typeControl =
    variant === "buttons" ? (
      <SegmentedRadio
        label={typeLabel}
        value={group}
        onChange={pick}
        options={groups.map((g) => ({
          value: g,
          label: (
            <>
              <Icon name={GROUP_ICON[g]} /> {GROUP_LABEL[g]}
            </>
          ),
        }))}
      />
    ) : (
      <select aria-label={typeLabel} value={group} onChange={(e) => pick(e.target.value as AccountGroup)}>
        {groups.map((g) => (
          <option key={g} value={g}>
            {GROUP_LABEL[g]}
          </option>
        ))}
      </select>
    );

  return (
    <span className={`account-picker ${variant}`}>
      {typeControl}
      {options.length === 0 ? (
        <span className="muted small">No active {GROUP_LABEL[group].toLowerCase()} accounts. Add one on the Accounts page.</span>
      ) : (
        <select aria-label={accountLabelText} value={selected && options.includes(selected) ? value : ""} onChange={(e) => onChange(e.target.value)}>
          {!(selected && options.includes(selected)) && <option value="">Choose…</option>}
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.pay_type === "cash" ? `${a.name} (cash)` : accountLabel(a, accounts)}
              {a.visibility === "private" ? " (private)" : ""}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
