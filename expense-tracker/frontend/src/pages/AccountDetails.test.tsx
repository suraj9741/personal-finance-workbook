import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AccountDetails } from "./AccountDetails";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ME = { id: "u1", email: "s@example.com", display_name: "Suraj", is_site_admin: false, household_id: "h1", household_name: "Home", role: "owner" };
const account = (id: string, name: string, pay_type: string, extra: object = {}) => ({
  id, name, pay_type, opening_balance: "0", visibility: "shared", owner_user_id: null, is_active: true,
  institution: null, description: null, opening_date: null, credit_limit: null, statement_day: null, due_day: null,
  opening_invested: "0", current_value: null, valued_on: null, ...extra,
});
const BANK = account("a1", "HDFC", "bank");
const CARD = account("a4", "HDFC CC", "credit_card", { institution: "HDFC Bank", opening_date: "2025-04-01", credit_limit: "100000.00", statement_day: 5 });
const figures = {
  account: CARD, balance: null, outstanding: "95000.00", available_credit: "5000.00", next_due_date: null, invested: null,
  deposited: null, withdrawn: null, current_value: null, unrealized_pl: null, realized_pl: null, realized_complete: true,
  month_income: "0", month_expenses: "3000.00", month_refunds: "0", month_transfers_in: "21000.00", month_transfers_out: "0",
  month_buys: "0", month_sells: "0",
};
const tx = (id: string, date: string, type: string, amount: string, extra: object = {}) => ({
  id, date, type, amount, description: id, account_id: "a4", to_account_id: null, category_id: null,
  cost_basis: null, counterparty: null, notes: null, created_by: null, created_by_name: null, ...extra,
});

function setup(path: string) {
  const lists: URLSearchParams[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const search = new URL(url, "http://x").searchParams;
    if (url.includes("/transactions")) lists.push(search);
    const body = url.includes("/auth/me") ? ME
      : url.includes("/summary") ? figures
      : url.includes("/transactions") ? { items: [tx("Card bill", "2026-10-05", "transfer", "21000.00", { account_id: "a1", to_account_id: "a4" }), tx("Swiggy", "2026-10-05", "expense", "300.00")], total: 2 }
      : url.includes("/accounts") ? [BANK, CARD]
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/accounts/:id" element={<AccountDetails />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return () => lists[lists.length - 1];
}

it("shows where you are, the card's one large number and its month, signed", async () => {
  setup("/accounts/a4?month=2026-10");
  expect(await screen.findByRole("heading", { level: 1, name: "HDFC CC" })).toBeTruthy();
  const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(crumbs).getByRole("link", { name: "Credit cards" }).getAttribute("href")).toBe("/accounts?type=credit_card");
  expect(screen.getByText(/^Credit card · HDFC Bank · opened 1 Apr 2025$/)).toBeTruthy();
  expect(screen.getByText("₹5,000.00 available of ₹1,00,000.00 · not cash")).toBeTruthy();
  // 95% of the limit used: the bar turns orange.
  expect(document.querySelector(".acct-hero .meter-fill")!.className).toContain("warn");
  expect(screen.getByText("Statement").nextSibling?.textContent).toBe("On the 5th");
  expect(screen.getByText("Purchases").nextSibling?.textContent).toBe("−₹3,000.00");
  expect(screen.getByText("Payments").nextSibling?.textContent).toBe("+₹21,000.00");
  // A card bill paid from the bank is money in here, but grey, not green.
  const bill = (await screen.findByRole("button", { name: /^Edit Card bill/ })).closest("tr")!;
  expect(within(bill).getByText("+₹21,000.00").className).toContain("transfer");
  expect(within(bill).getByRole("link", { name: "HDFC" }).getAttribute("href")).toBe("/accounts/a1");
});

it("lists only the chosen month's entries, or all dates", async () => {
  const lastList = setup("/accounts/a4?month=2026-10");
  expect(await screen.findByText("2 entries in October 2026")).toBeTruthy();
  expect(lastList().get("month")).toBe("2026-10");
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();

  fireEvent.change(screen.getByRole("combobox", { name: "Dates" }), { target: { value: "all" } });
  await waitFor(() => expect(lastList().has("month")).toBe(false));
  expect(await screen.findByText("2 entries")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();

  // Picking a month goes back to that month's entries.
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() => expect(lastList().get("month")).toBe("2026-11"));
  expect((screen.getByRole("combobox", { name: "Dates" }) as HTMLSelectElement).value).toBe("month");
});

it("says plainly when the account doesn't exist", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/summary")) return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
    return new Response(JSON.stringify(url.includes("/transactions") ? { items: [], total: 0 } : []), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/accounts/zz"]}>
        <Routes>
          <Route path="/accounts/:id" element={<AccountDetails />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("This account doesn't exist or isn't shared with you.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Back to accounts" })).toBeTruthy();
});
