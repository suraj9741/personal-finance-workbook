import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { shiftDay, today } from "../format";
import { Transactions } from "./Transactions";
import { amountText } from "../test-utils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tx = (id: string, date: string, type: string, amount: string, description = id) => ({
  id, date, type, amount, description, account_id: "a1", to_account_id: type === "transfer" ? "a2" : null, category_id: null,
  cost_basis: null, counterparty: null, notes: null, created_by: "u1", created_by_name: "Suraj",
});

function renderWith(items: object[], total = items.length) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/transactions") ? { items, total } : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Transactions />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const dayRow = (heading: string) => screen.getByRole("rowheader", { name: heading }).closest("tr")!;

it("groups rows by day and colours each day's net", async () => {
  const now = today();
  const y = shiftDay(now, -1);
  const older = shiftDay(now, -2);
  const evenDay = shiftDay(now, -3);
  renderWith([
    tx("swiggy", now, "expense", "400.00"),
    tx("card", now, "transfer", "9000.00"),
    tx("salary", y, "income", "1000.00"),
    tx("rent", y, "expense", "300.00"),
    tx("bonus", older, "income", "50.00"),
    tx("out", evenDay, "expense", "200.00"),
    tx("back", evenDay, "income", "200.00"),
  ]);
  await screen.findByRole("rowheader", { name: "Today" });

  // Spending only: red and minus. The transfer isn't counted.
  const todayTotal = within(dayRow("Today")).getByText(amountText(/₹400.00/)).closest(".day-total")!;
  expect(todayTotal.className).toContain("neg-text");
  expect(todayTotal.textContent).toMatch(/^−₹400.00/);

  // Income beat spending: green net, with the breakdown underneath.
  const mixed = within(dayRow("Yesterday")).getByText(amountText(/₹700.00/)).closest(".day-total")!;
  expect(mixed.className).toContain("pos-text");
  expect(mixed.textContent).toContain("Spent ₹300.00 · Income ₹1,000.00");

  // Came out even: neither red nor green.
  const even = dayRow(screen.getAllByRole("rowheader")[3].textContent!).querySelector(".day-total")!;
  expect(even.className).toContain("muted");
  expect(even.textContent).toMatch(/^₹0.00/);
});

it("marks the last day 'so far' when more rows are still to load", async () => {
  const now = today();
  renderWith([tx("a", now, "expense", "100.00")], 5);
  expect(await screen.findByText("so far")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show 4 more (4 left)" })).toBeTruthy();
});
