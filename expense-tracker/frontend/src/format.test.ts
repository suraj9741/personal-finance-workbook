import { describe, expect, it } from "vitest";
import type { Account } from "./api";
import {
  accountLabel,
  budgetDiff,
  budgetSplit,
  categoryKind,
  dayHeading,
  dayLabel,
  dayTotals,
  groupOf,
  minusMoney,
  money,
  percent,
  shiftMonth,
  signedMoney,
  tooManyDecimals,
  txSign,
} from "./format";

describe("format", () => {
  it("makes a positive budget diff mean good news", () => {
    expect(budgetDiff("expense", 3000, 1200)).toBe(1800);
    expect(budgetDiff("expense", 0, 500)).toBe(-500);
    expect(budgetDiff("income", 50000, 52000)).toBe(2000);
  });
  it("uses Indian digit grouping", () => {
    expect(money("108811")).toBe("₹1,08,811.00");
    expect(money(null)).toBe("—");
  });
  it("shows paise on every amount", () => {
    expect(money("1551.1")).toBe("₹1,551.10");
    expect(money(9147.18)).toBe("₹9,147.18");
    expect(money("500")).toBe("₹500.00");
    expect(signedMoney("-343.5")).toBe("−₹343.50");
    expect(minusMoney(-0.5)).toBe("−₹0.50");
  });
  it("rounds browser sums to paise, so leftovers never read as below zero", () => {
    // 0.1 + 0.2 - 0.3 is 5.5e-17 in JavaScript, not 0.
    expect(money(0.1 + 0.2 - 0.3)).toBe("₹0.00");
    expect(signedMoney(0.3 - 0.1 - 0.2)).toBe("₹0.00");
    expect(minusMoney(0.3 - 0.1 - 0.2)).toBe("₹0.00");
    const day = dayTotals([
      { type: "expense", amount: "0.10" },
      { type: "expense", amount: "0.20" },
      { type: "income", amount: "0.30" },
    ]);
    expect(day).toEqual({ spent: 0.3, earned: 0.3, net: 0 });
    expect(budgetDiff("expense", 0.3, 0.1 + 0.2)).toBe(0);
    expect(budgetSplit([{ kind: "expense", stats_group: "spend", budget: "0.10" }, { kind: "expense", stats_group: "spend", budget: "0.20" }]).spend).toBe(0.3);
  });
  it("spots amounts with more than 2 decimals", () => {
    expect(tooManyDecimals("10.555")).toBe(true);
    expect(tooManyDecimals("10.55")).toBe(false);
    expect(tooManyDecimals("10")).toBe(false);
    expect(tooManyDecimals(null)).toBe(false);
  });
  it("shifts months across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("formats savings rate", () => {
    expect(percent(0.756)).toBe("76%");
    expect(percent(null)).toBe("—");
  });
  it("adds the account type only when two accounts share a name", () => {
    const acc = (id: string, name: string, pay_type: Account["pay_type"]): Account => ({
      id, name, pay_type, opening_balance: "0", visibility: "shared", owner_user_id: null, is_active: true,
      institution: null, description: null, opening_date: null, credit_limit: null, statement_day: null,
      due_day: null, opening_invested: "0", current_value: null, valued_on: null,
    });
    const all = [acc("1", "SBI", "bank"), acc("2", "SBI", "credit_card"), acc("3", "HDFC", "bank")];
    expect(accountLabel(all[0], all)).toBe("SBI · bank");
    expect(accountLabel(all[1], all)).toBe("SBI · card");
    expect(accountLabel(all[2], all)).toBe("HDFC");
    expect(accountLabel(undefined, all)).toBe("");
  });
  it("files cash under Bank, the three primary types", () => {
    expect(groupOf("cash")).toBe("bank");
    expect(groupOf("credit_card")).toBe("credit_card");
    expect(groupOf("share_broker")).toBe("share_broker");
  });
  it("signs money in and out, and gives refunds an expense category", () => {
    expect([txSign("expense"), txSign("buy"), txSign("income"), txSign("refund"), txSign("sell"), txSign("transfer")]).toEqual(["−", "−", "+", "+", "+", ""]);
    expect(categoryKind("refund")).toBe("expense");
    expect(categoryKind("buy")).toBeNull();
    expect(categoryKind("transfer")).toBe("transfer");
  });
  it("labels days readably, with the year only when it differs", () => {
    expect(dayLabel("2026-10-17", "2026-10-20")).toBe("17 Oct");
    expect(dayLabel("2025-12-31", "2026-01-02")).toBe("31 Dec 2025");
    expect(dayHeading("2026-10-20", "2026-10-20")).toBe("Today");
    expect(dayHeading("2025-12-31", "2026-01-01")).toBe("Yesterday");
    expect(dayHeading("2026-10-16", "2026-10-20")).toBe("Fri, 16 Oct");
    expect(dayHeading("2025-12-30", "2026-01-02")).toBe("Tue, 30 Dec 2025");
  });
  it("totals a day without transfers, buys or sells", () => {
    const rows = [
      { type: "expense" as const, amount: "500" },
      { type: "refund" as const, amount: "100" },
      { type: "income" as const, amount: "1000" },
      { type: "transfer" as const, amount: "9999" },
      { type: "buy" as const, amount: "5000" },
    ];
    expect(dayTotals(rows)).toEqual({ spent: 400, earned: 1000, net: 600 });
  });
});
