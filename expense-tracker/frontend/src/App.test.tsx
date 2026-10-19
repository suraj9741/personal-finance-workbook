import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { amountText } from "./test-utils";

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
  expect(await screen.findByText(amountText("₹60,000.00"))).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
  expect(screen.getByText("Spent this month").nextSibling?.textContent).toBe("₹40,000.00");
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

it("shows budget, spent and what's left for expense and income", async () => {
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
  const left = (name: string) => screen.getByLabelText(`${name} budget`).closest(".budget-line")!.querySelector(".budget-status")!.textContent;
  await screen.findByLabelText("Everyday Food budget");
  expect(left("Everyday Food")).toBe("₹1,800.00 left");
  expect(left("Debt Tax")).toBe("—No budget");
  expect(left("Wages Paycheck")).toBe("₹2,000.00 above");
  expect(screen.getByText(amountText("Set in Sept 2026 · ₹1,000.00 from Dec 2026"))).toBeTruthy();
  expect(screen.getByText(amountText("₹1,800.00 left of ₹3,000.00"))).toBeTruthy();
  expect(screen.getByText(amountText("Earned ₹52,000.00 of ₹50,000.00 planned"))).toBeTruthy();
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
  expect(within(banks).getByText("3 accounts")).toBeTruthy();
  // The group total and HDFC, the one bank with money in it.
  expect(within(banks).getAllByText(amountText("₹42,000.00"))).toHaveLength(2);
  expect(within(banks).queryByText("Old SBI")).toBeNull();
  const cards = screen.getByText("Credit cards", { selector: "h2" }).closest(".card") as HTMLElement;
  expect(within(cards).getByText(amountText("owed · ₹75,000.00 available"))).toBeTruthy();
  expect(within(cards).getByText(amountText("₹25,000.00 owed"))).toBeTruthy();
  const brokers = screen.getByText("Share market brokers", { selector: "h2" }).closest(".card") as HTMLElement;
  expect(within(brokers).getByText("invested · no value entered")).toBeTruthy();
});

it("picks the account type first, then only accounts of that type", async () => {
  mockApi();
  renderAt("/transactions");
  fireEvent.click(await screen.findByRole("button", { name: "Full form" }));
  const dialog = await screen.findByRole("dialog");
  const types = within(dialog).getByRole("radiogroup", { name: "Account type" });
  fireEvent.click(within(types).getByRole("radio", { name: /Credit Card/ }));
  // Opens the account list and reads its rows (name, then what kind of account it is).
  const options = () => {
    fireEvent.click(within(dialog).getByRole("button", { name: /^Account / }));
    const names = within(screen.getByRole("listbox", { name: "Account" }))
      .getAllByRole("option")
      .map((o) => o.querySelector(".search-picker-name")!.textContent + " " + o.querySelector("small")!.textContent);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search account" }), { key: "Escape" });
    return names;
  };
  expect(options()).toEqual(["HDFC CC card"]);
  fireEvent.click(within(types).getByRole("radio", { name: /Bank/ }));
  expect(options()).toEqual(["HDFC bank", "SBI bank", "Cash cash"]);
  // Buying shares only offers brokers.
  fireEvent.click(within(dialog).getByRole("radio", { name: "Buy" }));
  expect(within(dialog).getAllByRole("radio", { name: /Share Market Broker/ })).toHaveLength(1);
  expect(within(dialog).queryByRole("radio", { name: /Bank/ })).toBeNull();
  expect(options()).toEqual(["Zerodha broker"]);
  expect(within(dialog).queryByRole("button", { name: /^Category / })).toBeNull();
});

it("shows a bank total below zero in red", async () => {
  mockApi((url) => (url.includes("/stats/overview") ? { ...OVERVIEW, totals: { ...OVERVIEW.totals, bank_balance: "-300" } } : undefined));
  renderAt("/");
  const overview = await screen.findByRole("region", { name: "Financial overview" });
  const label = within(overview).getByText("Total bank balance");
  expect(label.nextSibling?.textContent).toBe("-₹300.00");
  expect(label.parentElement?.className).toContain("bad");
});

it("shows the financial overview above the monthly dashboard", async () => {
  mockApi();
  renderAt("/");
  const overview = await screen.findByRole("region", { name: "Financial overview" });
  expect(within(overview).getByText("Total bank balance").nextSibling?.textContent).toBe("₹42,000.00");
  // Money held is green above zero (red below); the amount owed on cards stays plain.
  expect(within(overview).getByText("Total bank balance").parentElement?.className).toContain("good");
  expect(within(overview).getByText("Credit card outstanding").parentElement?.className).not.toMatch(/good|bad/);
  // Available credit is a note on the card tile now; Net cash and the month totals live in the hero.
  expect(within(overview).getByText("Credit card outstanding").parentElement?.textContent).toContain("₹75,000.00 of limits still available, not cash");
  expect(within(overview).queryByText("Net cash position")).toBeNull();
  expect(within(overview).queryByText("Expenses this month")).toBeNull();
  expect(within(overview).getByRole("columnheader", { name: "All expenses (month)" })).toBeTruthy();
  expect(screen.getByText("Net cash").nextSibling?.textContent).toBe("₹17,000.00");
  expect(within(overview).getByText("Portfolio value").nextSibling?.textContent).toBe("Not valued");
  expect(within(overview).getByText("0 of 1 brokers have a value entered")).toBeTruthy();
  expect(within(overview).getByRole("link", { name: "HDFC CC" }).getAttribute("href")).toBe("/accounts/a4");
  // The inactive account with no activity this month stays out of the table.
  expect(within(overview).queryByText("Old SBI")).toBeNull();
});

it("shows an account's figures and history on its page", async () => {
  const tx = { id: "t1", date: "2026-10-05", amount: "1000.00", type: "transfer", account_id: "a1", to_account_id: "a4", category_id: null, description: "Card bill", cost_basis: null, counterparty: null, notes: null, created_by: null, created_by_name: null };
  mockApi((url) =>
    url.includes("/accounts/a4/summary") ? figures(ACCOUNTS[3], { outstanding: "25000.00", available_credit: "75000.00", next_due_date: "2026-11-05", month_expenses: "3000.00", month_transfers_in: "1000.00" })
    : url.includes("/transactions?account_id=a4") ? { items: [tx], total: 1 }
    : undefined,
  );
  renderAt("/accounts/a4");
  expect(await screen.findByRole("heading", { name: /HDFC CC/ })).toBeTruthy();
  expect(screen.getByText("Outstanding").nextSibling?.textContent).toBe("₹25,000.00");
  expect(screen.getByText("Next due").nextSibling?.textContent).toMatch(/^5 Nov/);
  expect(screen.getByText("Payments").nextSibling?.textContent).toBe("+₹1,000.00");
  expect((await screen.findByRole("link", { name: "HDFC" })).getAttribute("href")).toBe("/accounts/a1");
  // The history row, now that the Payments figure also shows paise.
  expect(screen.getAllByText(amountText("+₹1,000.00")).some((e) => e.className.includes("transfer"))).toBe(true);
  expect(screen.getByRole("button", { name: "Edit account" })).toBeTruthy();
});

it("keeps unsaved budgets when you switch month and back", async () => {
  sessionStorage.clear();
  const categories = [{ id: "c1", kind: "expense", parent_name: "Everyday", sub_name: "Food", stats_group: "spend", is_active: true, sort_order: 0 }];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const month = new URL(url, "http://x").searchParams.get("month") ?? "";
    const body = url.includes("/auth/me") ? ME
      : url.includes("/budgets") ? { month, carries_forward: true, items: [], next_changes: [] }
      : url.includes("/categories") ? categories
      : url.includes("/accounts") ? [HDFC]
      : url.includes("/transactions") ? { items: [], total: 0 }
      : url.includes("/stats/month") ? { month, categories: [] }
      : null;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  renderAt("/budgets");
  const input = await screen.findByLabelText("Everyday Food budget");
  fireEvent.change(input, { target: { value: "5000" } });
  expect(screen.getByRole("region", { name: "Unsaved budgets" }).textContent).toMatch(/1 change for/);

  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.queryByRole("button", { name: "Save budgets" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(((await screen.findByLabelText("Everyday Food budget")) as HTMLInputElement).value).toBe("5000");

  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(((await screen.findByLabelText("Everyday Food budget")) as HTMLInputElement).value).toBe("");
  sessionStorage.clear();
});

it("says at once when an account with entries can't be deleted", async () => {
  const deletes: string[] = [];
  mockApi((url) => (url.includes("/transactions?account_id=a1") ? { items: [], total: 3 } : undefined));
  const fetchMock = vi.mocked(globalThis.fetch);
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method === "DELETE") deletes.push(String(input));
    return original(input, init);
  });
  renderAt("/accounts");
  fireEvent.click(await screen.findByRole("button", { name: "Edit HDFC" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect((await screen.findByRole("alert")).textContent).toBe("HDFC has 3 entries, so it can't be deleted. Deactivate it instead.");
  expect(deletes).toEqual([]);
  expect(screen.getByRole("dialog")).toBeTruthy();
});
