import type { Account } from "../api";
import { GROUP_ICON, groupOf } from "../format";
import { bankLogo } from "./bank-logos";
import { Icon } from "./Icon";

/**
 * The square beside an account's name: its bank's logo on a white tile (logos are drawn for a
 * light background, so the tile stays white in dark mode), or the type icon when there's no logo.
 */
export function AccountMark({ account, className }: { account: Pick<Account, "name" | "institution" | "pay_type">; className?: string }) {
  const logo = bankLogo(account);
  const classes = ["account-mark", logo ? "has-logo" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-hidden="true">
      {logo ? <img src={logo} alt="" /> : <Icon name={GROUP_ICON[groupOf(account.pay_type)]} />}
    </span>
  );
}
