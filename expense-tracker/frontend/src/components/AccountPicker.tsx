import { useState } from "react";
import type { Account } from "../api";
import { ACCOUNT_GROUPS, GROUP_ICON, GROUP_LABEL, groupOf, type AccountGroup } from "../format";
import { accountItems } from "./account-items";
import { Icon } from "./Icon";
import { SearchPicker } from "./SearchPicker";
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
  /** "buttons": pick the type with three big choices, then the account (full form). "compact": one searchable list of every account (quick add). */
  variant?: "buttons" | "compact";
}

/** Saves the account id. The full form asks for the type first; quick add searches all accounts at once. */
export function AccountPicker({ accounts, value, onChange, label, groups = ACCOUNT_GROUPS, exclude, variant = "buttons" }: Props) {
  const selected = accounts.find((a) => a.id === value);
  const [chosen, setChosen] = useState<AccountGroup | null>(null);
  const group: AccountGroup = selected ? groupOf(selected.pay_type) : (chosen ?? groups[0]);
  const allowed = accounts.filter((a) => groups.includes(groupOf(a.pay_type)) && a.id !== exclude);
  const options = variant === "compact" ? allowed : allowed.filter((a) => groupOf(a.pay_type) === group);
  const typeLabel = label ? `${label} account type` : "Account type";
  const accountLabelText = label ? `${label} account` : "Account";

  function pick(next: AccountGroup) {
    setChosen(next);
    const first = accounts.find((a) => groupOf(a.pay_type) === next && a.id !== exclude);
    onChange(first?.id ?? "");
  }

  return (
    <span className={`account-picker ${variant}`}>
      {variant === "buttons" && (
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
      )}
      {options.length === 0 ? (
        <span className="muted small">
          No active {variant === "buttons" ? `${GROUP_LABEL[group].toLowerCase()} ` : ""}accounts. Add one on the Accounts page.
        </span>
      ) : (
        <SearchPicker
          label={accountLabelText}
          items={accountItems(options)}
          value={selected && options.includes(selected) ? value : null}
          onChange={(id) => onChange(id ?? "")}
        />
      )}
    </span>
  );
}
