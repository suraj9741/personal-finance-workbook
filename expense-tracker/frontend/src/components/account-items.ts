import type { Account } from "../api";
import { ACCOUNT_GROUPS, GROUP_ICON, GROUP_PLURAL, groupOf } from "../format";
import type { PickerItem } from "./SearchPicker";

const KIND: Record<Account["pay_type"], string> = { bank: "bank", cash: "cash", credit_card: "card", share_broker: "broker" };

/**
 * Accounts as search-picker rows, banks first, then cards, then brokers. Each row says what the
 * account is, so "SBI" the bank and "SBI" the card can't be mixed up.
 */
export function accountItems(accounts: Account[]): PickerItem[] {
  return accounts
    .map((a) => ({ a, group: groupOf(a.pay_type) }))
    .sort((x, y) => ACCOUNT_GROUPS.indexOf(x.group) - ACCOUNT_GROUPS.indexOf(y.group))
    .map(({ a, group }) => ({
      id: a.id,
      label: a.name,
      group: GROUP_PLURAL[group],
      icon: GROUP_ICON[group],
      hint: a.visibility === "private" ? `${KIND[a.pay_type]} · private` : KIND[a.pay_type],
    }));
}
