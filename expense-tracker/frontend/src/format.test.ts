import { describe, expect, it } from "vitest";
import type { Account } from "./api";
import { accountLabel, budgetDiff, categoryKind, groupOf, money, percent, shiftMonth, txSign } from "./format";

describe("format", () => {
  it("makes a positive budget diff mean good news", () => {
    expect(budgetDiff("expense", 3000, 1200)).toBe(1800);
    expect(budgetDiff("expense", 0, 500)).toBe(-500);
    expect(budgetDiff("income", 50000, 52000)).toBe(2000);
  });
  it("uses Indian digit grouping", () => {
    expect(money("108811")).toBe("₹1,08,811");
    expect(money(null)).toBe("—");
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
});
