import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  cost_basis: null, counterparty: null, notes: null, created_by: "u1", created_by_name: "Suraj", can_edit: true,
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

it("filters by a whole category group as well as by one category", async () => {
  const cat = (id: string, kind: string, parent_name: string, sub_name: string) => ({ id, kind, parent_name, sub_name, stats_group: "spend", is_active: true });
  const categories = [cat("c1", "expense", "Everyday", "Food"), cat("c2", "expense", "Everyday", "Groceries"), cat("c3", "income", "Gotu", "Cash"), cat("c4", "income", "Gotu", "Bank"), cat("c5", "expense", "Debt", "Car EMI")];
  const urls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    urls.push(url);
    const body = url.includes("/transactions") ? { items: [], total: 0 } : url.includes("/categories") ? categories : [];
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
  const button = await screen.findByRole("button", { name: /^Category filter/ });
  fireEvent.click(button);
  const options = () => within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
  await vi.waitFor(() => expect(options()).toContain("All2 categories"));
  // Each group opens with its "All" row; income groups say so.
  // A group of one category has no "All" row.
  expect(options()).toEqual(["All categories", "All2 categories", "Food", "Groceries", "All2 categories", "Cash", "Bank", "Car EMI"]);
  fireEvent.click(within(screen.getByRole("listbox")).getAllByRole("option")[1]);
  await vi.waitFor(() => expect(urls.some((u) => u.includes("category_group=Everyday") && !u.includes("category_kind"))).toBe(true));
  expect(button.textContent).toContain("Everyday › All");
  // Picking one category replaces the group.
  fireEvent.click(button);
  fireEvent.click(within(screen.getByRole("listbox")).getByText("Cash"));
  await vi.waitFor(() => expect(urls.at(-1)).toMatch(/category_id=c3/));
  expect(urls.at(-1)).not.toMatch(/category_group/);
  // The income group sends its kind.
  fireEvent.click(button);
  fireEvent.click(within(screen.getByRole("listbox")).getAllByRole("option")[4]);
  await vi.waitFor(() => expect(urls.at(-1)).toMatch(/category_group=Gotu.*category_kind=income|category_kind=income.*category_group=Gotu/));
});

it("shows someone else's entry as view only, with no edit or category change", async () => {
  const now = today();
  renderWith([
    tx("mine", now, "expense", "100.00"),
    { ...tx("theirs", now, "expense", "200.00"), created_by: "u2", created_by_name: "Pratiksha", can_edit: false },
  ]);
  await screen.findByRole("rowheader", { name: "Today" });
  const theirs = screen.getByText("theirs").closest("tr")!;
  expect(within(theirs).queryByRole("button", { name: /Edit/ })).toBeNull();
  expect(within(theirs).getByText("View only").getAttribute("title")).toBe("Only Pratiksha can change this entry");
  expect(within(theirs).getByText("Uncategorized")).toBeTruthy();
  const mine = screen.getByText("mine").closest("tr")!;
  expect(within(mine).getByRole("button", { name: /Edit mine/ })).toBeTruthy();
});
