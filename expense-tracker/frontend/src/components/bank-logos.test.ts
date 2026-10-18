import { expect, it } from "vitest";
import type { Account } from "../api";
import amazonPay from "../assets/banks/amazon-pay.png";
import angelOne from "../assets/banks/angel-one.png";
import coin from "../assets/banks/coin.png";
import dhan from "../assets/banks/dhan.png";
import { accountIcon } from "../format";
import { bankLogo } from "./bank-logos";

// Small SVGs come back inlined as data: URLs, so read the logo's <title> to tell which it is.
const logoTitle = (a: Parameters<typeof bankLogo>[0]) => decodeURIComponent(bankLogo(a) ?? "").match(/<title>([^<]+)/i)?.[1];
const acct = (name: string, institution: string | null = null, pay_type: Account["pay_type"] = "bank") => ({ name, institution, pay_type });

it("finds the logo from the institution first, then the name", () => {
  expect(logoTitle(acct("HDFC"))).toBe("HDFC Bank");
  expect(logoTitle(acct("HDFC CC", null, "credit_card"))).toBe("HDFC Bank");
  expect(logoTitle(acct("Salary", "ICICI Bank"))).toBe("ICICI Bank");
  expect(logoTitle(acct("FI"))).toBe("Fi");
  expect(logoTitle(acct("Zerodha", null, "share_broker"))).toBe("Zerodha");
  expect(logoTitle(acct("SBI", null, "credit_card"))).toBe("State Bank of India");
  // Big SVGs stay files instead of being inlined.
  expect(bankLogo(acct("BOI"))).toMatch(/boi\.svg$/);
  expect(bankLogo(acct("Indusland", null, "credit_card"))).toMatch(/indusind\.svg$/);
  expect(logoTitle(acct("Yes Bank", null, "credit_card"))).toBe("Yes Bank");
  // PNGs, for brands with no vector logo.
  expect(bankLogo(acct("Amazon Pay", null, "credit_card"))).toBe(amazonPay);
  expect(bankLogo(acct("Angel One", null, "share_broker"))).toBe(angelOne);
  expect(bankLogo(acct("Demat", "AngelOne", "share_broker"))).toBe(angelOne);
  expect(bankLogo(acct("Dhan", null, "share_broker"))).toBe(dhan);
  expect(bankLogo(acct("Coin", null, "share_broker"))).toBe(coin);
  expect(bankLogo(acct("Mutual funds", "Zerodha Coin", "share_broker"))).toBe(coin);
});

it("matches whole words only, and gives none for cash or banks without a logo yet", () => {
  // "fi" inside "Fixed deposit" is not Fi.
  expect(bankLogo(acct("Fixed deposit"))).toBeUndefined();
  expect(bankLogo(acct("Cash", null, "cash"))).toBeUndefined();
  expect(bankLogo(acct("My savings"))).toBeUndefined();
});

it("gives cash the rupee sign, and the other accounts their type's icon", () => {
  expect(accountIcon("cash")).toBe("rupee");
  expect(accountIcon("bank")).toBe("bank");
  expect(accountIcon("credit_card")).toBe("card");
  expect(accountIcon("share_broker")).toBe("chart");
});
