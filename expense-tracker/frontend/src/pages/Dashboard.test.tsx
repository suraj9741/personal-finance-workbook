import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import { amountText } from "../test-utils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const line = (category_id: string, stats_group: string, budget: string | null, actual: string) => ({
  category_id, kind: "expense", parent_name: stats_group === "saving" ? "Savings" : "Everyday", sub_name: category_id,
  stats_group, budget, actual, diff: "0", over_budget: budget !== null && Number(actual) > Number(budget),
});
const month = (scope: string, extra: object = {}) => ({
  month: "2026-10", scope, income: "100000", spend: "9500", saved: "90500", savings_rate: 0.905, invested: "5000",
  lent: "0", repaid: "0", budget_total: "15000",
  // A spending budget of ₹10,000 and a ₹5,000 savings budget: "spent" is only compared with the first.
  categories: [line("Food", "spend", "10000", "9500"), line("PPF", "saving", "5000", "5000")],
  ...extra,
});
const OVERVIEW = {
  month: "2026-10",
  totals: { bank_balance: "50000", card_outstanding: "8000", available_credit: null, broker_cash: "0", invested: "0", portfolio_value: null, brokers_valued: 0, brokers: 0, month_income: "100000", month_expenses: "14500", net_cash: "42000" },
  accounts: [{
    account: { id: "a1", name: "HDFC", pay_type: "bank", opening_balance: "0", visibility: "shared", owner_user_id: null, is_active: true },
    balance: "50000", outstanding: null, available_credit: null, next_due_date: null, invested: null, deposited: null, withdrawn: null,
    current_value: null, unrealized_pl: null, realized_pl: null, realized_complete: true, month_income: "100000", month_expenses: "14500",
    month_refunds: "0", month_transfers_in: "0", month_transfers_out: "0", month_buys: "0", month_sells: "0",
  }],
};

function renderWith({ household = month("household"), me = month("me"), overview = OVERVIEW, uncategorized = 0 }: { household?: object; me?: object; overview?: object; uncategorized?: number } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/stats/month") ? (url.includes("scope=me") ? me : household)
      : url.includes("/stats/overview") ? overview
      : url.includes("/stats/attention") ? { month: "2026-10", uncategorized, over_budget: [], old_loans: [], no_income: false, credit_card_category_used: 0 }
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const hero = () => screen.getByRole("region", { name: /at a glance/ });
const value = (label: string) => within(hero()).getByText(label).nextSibling?.textContent;

it("shows Net cash, Spent and Saved at the top", async () => {
  renderWith();
  expect(await screen.findByText(amountText("₹90,500.00"))).toBeTruthy();
  expect(within(hero()).getAllByRole("term").map((t) => t.textContent)).toEqual([
    "Net cash", "Spent this month", "Saved this month", "Income", "Savings rate", "Invested", "Lent", "Repaid to you",
  ]);
  expect(value("Net cash")).toBe("₹42,000.00");
  expect(value("Spent this month")).toBe("₹9,500.00");
  expect(within(hero()).getByText(amountText(/Bank & cash ₹50,000.00 − card dues ₹8,000.00 · household/))).toBeTruthy();
  expect(within(hero()).getByText(amountText("91% of income ₹1,00,000.00"))).toBeTruthy();
  expect(within(hero()).getByText(amountText(/All expense entries: ₹14,500.00 = spent \+ invested \+ lent/))).toBeTruthy();
  expect(screen.getByText("Nothing needs attention this month.")).toBeTruthy();
});

it("compares spent with the spending budget only, leaving savings budgets out", async () => {
  renderWith();
  expect(await within(hero()).findByText(amountText(/of ₹10,000.00 budget/))).toBeTruthy();
  expect(within(hero()).getByText(amountText(/of ₹10,000.00 budget/)).textContent).toBe("of ₹10,000.00 budget · ₹500.00 left");
  // 95% of the budget: the meter turns orange, and it's hidden from screen readers.
  const meter = hero().querySelector(".hero-meter")!;
  expect(meter.getAttribute("aria-hidden")).toBe("true");
  expect(meter.querySelector(".meter-fill")!.className).toContain("warn");
  expect(screen.getByText(amountText("spending budget ₹10,000.00 + ₹5,000.00 planned savings"))).toBeTruthy();
});

it("says when spending is over budget, in words", async () => {
  renderWith({ household: month("household", { spend: "12300", saved: "87700", categories: [line("Food", "spend", "10000", "12300")] }) });
  expect((await screen.findByText(amountText("₹2,300.00 over budget"))).className).toContain("neg-text");
  expect(screen.getByText(amountText("over by ₹2,300.00"))).toBeTruthy();
  expect(hero().querySelector(".hero-meter .meter-fill")!.className).toContain("over");
});

it("offers to set budgets when there is no spending budget", async () => {
  renderWith({ household: month("household", { categories: [line("Food", "spend", null, "9500"), line("PPF", "saving", "5000", "5000")] }) });
  const link = await within(hero()).findByRole("link", { name: "Set budgets" });
  // It opens Budgets on the month being looked at.
  expect(link.getAttribute("href")).toMatch(/^\/budgets\?month=\d{4}-\d{2}$/);
  expect(link.parentElement?.textContent).toBe("No spending budget · Set budgets");
  expect(hero().querySelector(".hero-meter")).toBeNull();
});

it("switches Spent and Saved to Just me, hides budgets and keeps Net cash household", async () => {
  renderWith({ me: month("me", { spend: "2000", saved: "98000", savings_rate: 0.98, categories: [line("Food", "spend", "10000", "2000"), line("Rent", "spend", "20000", "0")] }) });
  await screen.findByText(amountText("₹90,500.00"));
  const household = screen.getByRole("radio", { name: "Household" });
  expect(household.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radiogroup", { name: "Show figures for" })).toBeTruthy();

  // Arrow keys move the choice and the focus (roving tabIndex).
  fireEvent.keyDown(household, { key: "ArrowRight" });
  const justMe = screen.getByRole("radio", { name: "Just me" });
  expect(justMe.getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(justMe);
  expect(justMe.tabIndex).toBe(0);
  expect(household.tabIndex).toBe(-1);

  expect(await screen.findByText(amountText("₹98,000.00"))).toBeTruthy();
  expect(value("Spent this month")).toBe("₹2,000.00");
  expect(value("Net cash")).toBe("₹42,000.00");
  expect(within(hero()).getByText("Budgets are household-wide")).toBeTruthy();
  expect(hero().querySelector(".hero-meter")).toBeNull();
  expect(screen.getByText("Just me · entries you added and your private accounts")).toBeTruthy();
  expect(screen.getByRole("heading", { name: /^This month by category/ }).textContent).toBe("This month by category · Just me");
  expect(screen.getByText("Budgets are household-wide, so they're hidden in Just me.")).toBeTruthy();
  // Bars show your own spending only, with no budget figures.
  const bars = screen.getByRole("heading", { name: "Budget vs actual" }).closest(".card") as HTMLElement;
  expect(within(bars).queryByText(/\/ ₹10,000.00/)).toBeNull();
  expect(within(bars).queryByText(/Rent/)).toBeNull();
  // Needs attention stays household.
  expect(screen.getByText("Household", { selector: ".card-caption" })).toBeTruthy();
});

it("marks negative numbers with a minus sign and words, not just red", async () => {
  renderWith({
    household: month("household", { income: "20000", spend: "25000", saved: "-5000", savings_rate: -0.25 }),
    overview: { ...OVERVIEW, totals: { ...OVERVIEW.totals, bank_balance: "5000", card_outstanding: "12000", net_cash: "-7000" } },
  });
  expect(await screen.findByText(amountText("−₹5,000.00"))).toBeTruthy();
  expect(screen.getByText(amountText("Spent ₹5,000.00 more than came in"))).toBeTruthy();
  expect(await screen.findByText(amountText("−₹7,000.00"))).toBeTruthy();
  expect(screen.getByText("Cards owe more than the bank holds")).toBeTruthy();
  expect(screen.getByText("Net cash").parentElement?.className).toContain("bad");
});

it("lets a whole account row open the account, with its tags outside the link", async () => {
  const cash = { ...OVERVIEW.accounts[0], account: { ...OVERVIEW.accounts[0].account, id: "a2", name: "Wallet", pay_type: "cash" } };
  renderWith({ overview: { ...OVERVIEW, accounts: [...OVERVIEW.accounts, cash] } });
  const link = await screen.findByRole("link", { name: "Wallet" });
  expect(link.getAttribute("href")).toBe("/accounts/a2");
  expect(link.className).toBe("row-link");
  expect(link.closest("tr")!.className).toBe("link-row");
  // The tag sits beside the name, so it isn't underlined or read as part of the link.
  expect(link.parentElement!.querySelector(".tag")!.textContent).toBe("cash");
});

it("shows each Needs attention item that opens something as a row", async () => {
  renderWith({ uncategorized: 3 });
  const link = await screen.findByRole("link", { name: "3 entries have no category" });
  expect(link.className).toBe("attention-link");
});

it("shows each card's statement by its own statement day, and what's unbilled", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 24, 12));
  const base = OVERVIEW.accounts[0];
  const card = (id: string, name: string, extra: object) => ({
    ...base, balance: null, outstanding: "1000", available_credit: null, month_expenses: "999", month_transfers_in: "111",
    account: { ...base.account, id, name, pay_type: "credit_card", credit_limit: null, statement_day: null, due_day: null },
    ...extra,
  });
  const amazon = card("c1", "Amazon Pay", {
    account: { ...base.account, id: "c1", name: "Amazon Pay", pay_type: "credit_card", credit_limit: null, statement_day: 20, due_day: 7 },
    statement_start: "2026-09-21", statement_end: "2026-10-20", statement_purchases: "450.00", statement_payments: "900.00",
    unbilled_since: "2026-10-21", unbilled: "470.00",
  });
  const plain = card("c2", "ICICI", { statement_start: null, statement_end: null, statement_purchases: null, statement_payments: null, unbilled_since: null, unbilled: null });
  renderWith({ overview: { ...OVERVIEW, accounts: [...OVERVIEW.accounts, amazon, plain] } });
  const row = (await screen.findByRole("link", { name: "Amazon Pay" })).closest("tr")!;
  const cell = (r: HTMLElement, label: string) => r.querySelector(`[data-label="${label}"]`)!.textContent;
  expect(cell(row, "October statement")).toMatch(/^₹450\.0021 Sept? – 20 Oct$/);
  expect(cell(row, "Payments")).toBe("₹900.00");
  expect(cell(row, "Unbilled")).toBe("₹470.0021 Oct – today");
  // No statement day: the calendar month, said so.
  const icici = screen.getByRole("link", { name: "ICICI" }).closest("tr")!;
  expect(cell(icici, "October statement")).toBe("₹999.00Calendar month · no statement day");
  expect(cell(icici, "Payments")).toBe("₹111.00");
  const totals = row.closest("table")!.querySelector("tfoot")!;
  expect(cell(totals, "October statement")).toBe("₹1,449.00");
  expect(cell(totals, "Unbilled")).toBe("₹470.00");
});
