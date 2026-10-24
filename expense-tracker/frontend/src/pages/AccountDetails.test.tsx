import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AccountDetails } from "./AccountDetails";
import { amountText } from "../test-utils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

const ITEMS = [tx("Card bill", "2026-10-05", "transfer", "21000.00", { account_id: "a1", to_account_id: "a4" }), tx("Swiggy", "2026-10-05", "expense", "300.00")];

function setup(path: string, { summary = figures as object, items = ITEMS as object[], accounts = [BANK, CARD] as object[] } = {}) {
  const lists: URLSearchParams[] = [];
  const patches: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const search = new URL(url, "http://x").searchParams;
    if (init?.method === "PATCH") {
      patches.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(items[0]), { status: 200 });
    }
    if (url.includes("/transactions")) lists.push(search);
    const body = url.includes("/auth/me") ? ME
      : url.includes("/summary") ? summary
      : url.includes("/transactions") ? { items, total: items.length }
      : url.includes("/accounts") ? accounts
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
  const lastList = () => lists[lists.length - 1];
  return Object.assign(lastList, { patches });
}

it("shows where you are, the card's one large number and its month, signed", async () => {
  setup("/accounts/a4?month=2026-10");
  expect(await screen.findByRole("heading", { level: 1, name: "HDFC CC" })).toBeTruthy();
  const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(crumbs).getByRole("link", { name: "Credit cards" }).getAttribute("href")).toBe("/accounts?type=credit_card");
  expect(screen.getByText(/^Credit card · HDFC Bank · opened 1 Apr 2025$/)).toBeTruthy();
  expect(screen.getByText(amountText("₹5,000.00 available of ₹1,00,000.00 · not cash"))).toBeTruthy();
  // 95% of the limit used: the bar turns orange.
  expect(document.querySelector(".acct-hero .meter-fill")!.className).toContain("warn");
  expect(screen.getByText("Statement").nextSibling?.textContent).toBe("On the 5th");
  expect(screen.getByText("Purchases").nextSibling?.textContent).toBe("−₹3,000.00");
  expect(screen.getByText("Payments").nextSibling?.textContent).toBe("+₹21,000.00");
  // A card bill paid from the bank is money in here, but grey, not green.
  const bill = (await screen.findByRole("button", { name: /^Edit Card bill/ })).closest("tr")!;
  expect(within(bill).getByText(amountText("+₹21,000.00")).className).toContain("transfer");
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

it("shows a card's statement, where each bill closes, and moves a late entry to the next bill", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 24, 12));
  const card = account("a5", "Amazon Pay", "credit_card", { credit_limit: "100000.00", statement_day: 20 });
  const summary = {
    ...figures, account: card, statement_start: "2026-09-21", statement_end: "2026-10-20", statement_purchases: "450.00",
    statement_refunds: "50.00", statement_payments: "900.00", statement_credits: "25.00", unbilled_since: "2026-10-21", unbilled: "470.00",
  };
  const items = [
    tx("Swiggy", "2026-10-22", "expense", "70.00", { account_id: "a5" }),
    tx("Amazon order", "2026-10-20", "expense", "300.00", { account_id: "a5" }),
    tx("Petrol", "2026-10-18", "expense", "400.00", { account_id: "a5", posted_on: "2026-10-21" }),
  ];
  const { patches } = setup("/accounts/a5?month=2026-10", { summary, items, accounts: [BANK, card] });
  expect(await screen.findByRole("heading", { level: 1, name: "Amazon Pay" })).toBeTruthy();
  expect(screen.getByText("October statement").nextSibling?.textContent).toBe("−₹450.00");
  expect(screen.getByText(amountText(/^21 Sept? – 20 Oct · after ₹50.00 refunds$/))).toBeTruthy();
  expect(screen.getByText("Payments").nextSibling?.textContent).toBe("+₹900.00");
  expect(screen.getByText("Unbilled").nextSibling?.textContent).toBe("−₹470.00");
  expect(screen.getByText("21 Oct – today")).toBeTruthy();
  // The line sits between the 22nd (next bill) and the 20th (October's bill).
  expect(await screen.findByText("October bill closed on 20 Oct · newer entries go on the November bill")).toBeTruthy();
  // Bought on the statement day: offered a move. Bought after it: nothing to move.
  const swiggy = screen.getByRole("button", { name: /^Edit Swiggy/ }).closest("tr")!;
  expect(within(swiggy).queryByRole("button", { name: "Move to next statement" })).toBeNull();
  const order = screen.getByRole("button", { name: /^Edit Amazon order/ }).closest("tr")!;
  fireEvent.click(within(order).getByRole("button", { name: "Move to next statement" }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0].body).toEqual({ posted_on: "2026-10-21" });
  // Already moved: it says where it went, and Undo clears the posted date.
  const petrol = screen.getByRole("button", { name: /^Edit Petrol/ }).closest("tr")!;
  expect(within(petrol).getByText("November bill")).toBeTruthy();
  expect(within(petrol).getByText("Posted 21 Oct, so it counts on the November bill.")).toBeTruthy();
  fireEvent.click(within(petrol).getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(patches).toHaveLength(2));
  expect(patches[1].body).toEqual({ posted_on: null });
});
