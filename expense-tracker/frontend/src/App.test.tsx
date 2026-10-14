import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ME = { id: "u1", email: "s@example.com", display_name: "Suraj", is_site_admin: true, household_id: "h1", household_name: "Home", role: "owner" };
const account = (id: string, name: string, pay_type: string, extra: object = {}) => ({
  id, name, pay_type, opening_balance: "0", visibility: "shared", owner_user_id: null, is_active: true,
  institution: null, description: null, opening_date: null, credit_limit: null, statement_day: null, due_day: null,
  opening_invested: "0", current_value: null, valued_on: null, ...extra,
});
const HDFC = account("a1", "HDFC", "bank");

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("sends logged-out visitors to the login page", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "Not logged in" }), { status: 401 }));
  renderAt("/");
  expect(await screen.findByRole("button", { name: "Log in" })).toBeTruthy();
});

it("shows the dashboard and quick-add bar when logged in", async () => {
  const me = ME;
  const stats = { month: "2026-10", scope: "household", income: "100000", spend: "40000", saved: "60000", savings_rate: 0.6, invested: "0", lent: "0", repaid: "0", budget_total: "0", categories: [] };
  const attention = { month: "2026-10", uncategorized: 2, over_budget: [], old_loans: [], no_income: false, credit_card_category_used: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/auth/me") ? me
      : url.includes("/stats/month") ? stats
      : url.includes("/stats/attention") ? attention
      : url.includes("/transactions") ? { items: [], total: 0 }
      : url.includes("/accounts") ? [HDFC]
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  renderAt("/");
  expect(await screen.findByText("₹60,000")).toBeTruthy();
  expect(screen.getByRole("form", { name: "Quick add" })).toBeTruthy();
  expect(await screen.findByText("2 entries have no category")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Admin" })).toBeTruthy();
});

it("asks a new household to add its first account", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/auth/me") ? { ...ME, is_site_admin: false }
      : url.includes("/transactions") ? { items: [], total: 0 }
      : url.includes("/stats/") ? null
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  renderAt("/");
  const welcome = await screen.findByText(/Add your first account/);
  expect(within(welcome).getByRole("link", { name: "Accounts" })).toBeTruthy();
  expect(screen.queryByRole("form", { name: "Quick add" })).toBeNull();
});

it("shows budget, spent and diff for expense and income", async () => {
  const cat = (id: string, kind: string, parent_name: string, sub_name: string) => ({ id, kind, parent_name, sub_name, stats_group: kind === "income" ? "earned" : "spend", is_active: true, sort_order: 0 });
  const categories = [cat("c1", "expense", "Everyday", "Food"), cat("c2", "expense", "Debt", "Tax"), cat("c3", "income", "Wages", "Paycheck")];
  const line = (category_id: string, kind: string, actual: string) => ({ category_id, kind, parent_name: "", sub_name: "", stats_group: "spend", budget: null, actual, diff: "0", over_budget: false });
  const stats = { month: "2026-10", scope: "household", income: "52000", spend: "1200", saved: "0", savings_rate: null, invested: "0", lent: "0", repaid: "0", budget_total: "3000", categories: [line("c1", "expense", "1200"), line("c3", "income", "52000")] };
  const budgets = { month: "2026-10", carries_forward: true, items: [{ category_id: "c1", amount: "3000.00", this_month_only: false, set_in: "2026-09" }, { category_id: "c3", amount: "50000.00", this_month_only: false, set_in: "2026-10" }], next_changes: [{ category_id: "c1", month: "2026-12", amount: "1000.00" }] };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/auth/me") ? ME
      : url.includes("/budgets") ? budgets
      : url.includes("/stats/month") ? stats
      : url.includes("/stats/attention") ? null
      : url.includes("/categories") ? categories
      : url.includes("/accounts") ? [HDFC]
      : url.includes("/transactions") ? { items: [], total: 0 }
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  renderAt("/budgets");
  expect((await screen.findByLabelText("Everyday Food diff")).textContent).toBe("₹1,800");
  expect(screen.getByLabelText("Debt Tax diff").textContent).toBe("₹0");
  expect(screen.getByLabelText("Wages Paycheck diff").textContent).toBe("₹2,000");
  expect(screen.getByText("since September 2026, until November 2026, then ₹1,000")).toBeTruthy();
  expect(within(screen.getByLabelText("Expense totals")).getByText("₹1,800")).toBeTruthy();
});

const ACCOUNTS = [
  HDFC,
  account("a2", "SBI", "bank"),
  account("a3", "Cash", "cash"),
  account("a4", "HDFC CC", "credit_card", { credit_limit: "100000.00" }),
  account("a5", "Zerodha", "share_broker"),
  account("a6", "Old SBI", "bank", { is_active: false }),
];
const figures = (a: ReturnType<typeof account>, extra: object = {}) => ({
  account: a, balance: null, outstanding: null, available_credit: null, next_due_date: null, invested: null,
  deposited: null, withdrawn: null, current_value: null, unrealized_pl: null, realized_pl: null, realized_complete: true,
  month_income: "0", month_expenses: "0", month_refunds: "0", month_transfers_in: "0", month_transfers_out: "0",
  month_buys: "0", month_sells: "0", ...extra,
});
const OVERVIEW = {
  month: "2026-10",
  totals: { bank_balance: "42000", card_outstanding: "25000", available_credit: "75000", broker_cash: "0", invested: "50000", portfolio_value: null, brokers_valued: 0, brokers: 1, month_income: "10000", month_expenses: "18000", net_cash: "17000" },
  accounts: [
    figures(ACCOUNTS[0], { balance: "42000.00" }),
    figures(ACCOUNTS[1], { balance: "0.00" }),
    figures(ACCOUNTS[2], { balance: "0.00" }),
    figures(ACCOUNTS[3], { outstanding: "25000.00", available_credit: "75000.00" }),
    figures(ACCOUNTS[4], { balance: "0.00", invested: "50000.00" }),
    figures(ACCOUNTS[5], { balance: "0.00" }),
  ],
};

function mockApi(extra: (url: string) => unknown = () => undefined) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = extra(url) ?? (url.includes("/auth/me") ? ME
      : url.includes("/stats/overview") ? OVERVIEW
      : url.includes("/accounts") ? ACCOUNTS.filter((a) => a.is_active || url.includes("include_inactive"))
      : url.includes("/transactions") ? { items: [], total: 0 }
      : url.includes("/stats/") ? null
      : []);
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

it("lists accounts grouped by type with counts and figures", async () => {
  mockApi();
  renderAt("/accounts");
  const banks = (await screen.findByText("Bank accounts", { selector: "h2" })).closest(".card") as HTMLElement;
  expect(within(banks).getByText("(3 active)")).toBeTruthy();
  expect(within(banks).getByText("₹42,000")).toBeTruthy();
  expect(within(banks).queryByText("Old SBI")).toBeNull();
  const cards = screen.getByText("Credit cards", { selector: "h2" }).closest(".card") as HTMLElement;
  expect(within(cards).getByText("· ₹75,000 available credit")).toBeTruthy();
  const brokers = screen.getByText("Share market brokers", { selector: "h2" }).closest(".card") as HTMLElement;
  expect(within(brokers).getByText("· no value entered")).toBeTruthy();
});

it("picks the account type first, then only accounts of that type", async () => {
  mockApi();
  renderAt("/transactions");
  fireEvent.click(await screen.findByRole("button", { name: "Full form" }));
  const dialog = await screen.findByRole("dialog");
  const types = within(dialog).getByRole("radiogroup", { name: "Account type" });
  fireEvent.click(within(types).getByRole("radio", { name: /Credit Card/ }));
  const options = () => within(within(dialog).getByRole("combobox", { name: "Account" })).getAllByRole("option").map((o) => o.textContent);
  expect(options()).toEqual(["HDFC CC"]);
  fireEvent.click(within(types).getByRole("radio", { name: /Bank/ }));
  expect(options()).toEqual(["HDFC", "SBI", "Cash (cash)"]);
  // Buying shares only offers brokers.
  fireEvent.click(within(dialog).getByRole("radio", { name: "Buy" }));
  expect(within(dialog).getAllByRole("radio", { name: /Share Market Broker/ })).toHaveLength(1);
  expect(within(dialog).queryByRole("radio", { name: /Bank/ })).toBeNull();
  expect(options()).toEqual(["Zerodha"]);
  expect(within(dialog).queryByRole("combobox", { name: "Category group" })).toBeNull();
});
