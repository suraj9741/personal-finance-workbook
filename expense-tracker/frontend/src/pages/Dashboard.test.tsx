import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

function renderWith({ household = month("household"), me = month("me"), overview = OVERVIEW }: { household?: object; me?: object; overview?: object } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/stats/month") ? (url.includes("scope=me") ? me : household)
      : url.includes("/stats/overview") ? overview
      : url.includes("/stats/attention") ? { month: "2026-10", uncategorized: 0, over_budget: [], old_loans: [], no_income: false, credit_card_category_used: 0 }
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
  expect(await screen.findByText("₹90,500")).toBeTruthy();
  expect(within(hero()).getAllByRole("term").map((t) => t.textContent)).toEqual([
    "Net cash", "Spent this month", "Saved this month", "Income", "Savings rate", "Invested", "Lent", "Repaid to you",
  ]);
  expect(value("Net cash")).toBe("₹42,000");
  expect(value("Spent this month")).toBe("₹9,500");
  expect(within(hero()).getByText(/Bank & cash ₹50,000 − card dues ₹8,000 · household/)).toBeTruthy();
  expect(within(hero()).getByText("91% of income ₹1,00,000")).toBeTruthy();
  expect(within(hero()).getByText(/All expense entries: ₹14,500 = spent \+ invested \+ lent/)).toBeTruthy();
  expect(screen.getByText("Nothing needs attention this month.")).toBeTruthy();
});

it("compares spent with the spending budget only, leaving savings budgets out", async () => {
  renderWith();
  expect(await within(hero()).findByText(/of ₹10,000 budget/)).toBeTruthy();
  expect(within(hero()).getByText(/of ₹10,000 budget/).textContent).toBe("of ₹10,000 budget · ₹500 left");
  // 95% of the budget: the meter turns orange, and it's hidden from screen readers.
  const meter = hero().querySelector(".hero-meter")!;
  expect(meter.getAttribute("aria-hidden")).toBe("true");
  expect(meter.querySelector(".meter-fill")!.className).toContain("warn");
  expect(screen.getByText("spending budget ₹10,000 + ₹5,000 planned savings")).toBeTruthy();
});

it("says when spending is over budget, in words", async () => {
  renderWith({ household: month("household", { spend: "12300", saved: "87700", categories: [line("Food", "spend", "10000", "12300")] }) });
  expect((await screen.findByText("₹2,300 over budget")).className).toContain("neg-text");
  expect(screen.getByText("over by ₹2,300")).toBeTruthy();
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
  await screen.findByText("₹90,500");
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

  expect(await screen.findByText("₹98,000")).toBeTruthy();
  expect(value("Spent this month")).toBe("₹2,000");
  expect(value("Net cash")).toBe("₹42,000");
  expect(within(hero()).getByText("Budgets are household-wide")).toBeTruthy();
  expect(hero().querySelector(".hero-meter")).toBeNull();
  expect(screen.getByText("Just me · entries you added and your private accounts")).toBeTruthy();
  expect(screen.getByRole("heading", { name: /^This month by category/ }).textContent).toBe("This month by category · Just me");
  expect(screen.getByText("Budgets are household-wide, so they're hidden in Just me.")).toBeTruthy();
  // Bars show your own spending only, with no budget figures.
  const bars = screen.getByRole("heading", { name: "Budget vs actual" }).closest(".card") as HTMLElement;
  expect(within(bars).queryByText(/\/ ₹10,000/)).toBeNull();
  expect(within(bars).queryByText(/Rent/)).toBeNull();
  // Needs attention stays household.
  expect(screen.getByText("Household", { selector: ".card-caption" })).toBeTruthy();
});

it("marks negative numbers with a minus sign and words, not just red", async () => {
  renderWith({
    household: month("household", { income: "20000", spend: "25000", saved: "-5000", savings_rate: -0.25 }),
    overview: { ...OVERVIEW, totals: { ...OVERVIEW.totals, bank_balance: "5000", card_outstanding: "12000", net_cash: "-7000" } },
  });
  expect(await screen.findByText("−₹5,000")).toBeTruthy();
  expect(screen.getByText("Spent ₹5,000 more than came in")).toBeTruthy();
  expect(await screen.findByText("−₹7,000")).toBeTruthy();
  expect(screen.getByText("Cards owe more than the bank holds")).toBeTruthy();
  expect(screen.getByText("Net cash").parentElement?.className).toContain("bad");
});
