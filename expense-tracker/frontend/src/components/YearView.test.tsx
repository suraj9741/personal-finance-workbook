import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Dashboard } from "../pages/Dashboard";
import { amountText } from "../test-utils";
import { YearView } from "./YearView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const zero = { income: "0", spend: "0", saved: "0", invested: "0", lent: "0", repaid: "0", budget: null };
// Tracked from 18 October: nine untracked months, October partial, November and December to come.
const months = Array.from({ length: 12 }, (_, i) => ({
  ...zero,
  month: `2026-${String(i + 1).padStart(2, "0")}`,
  status: i < 9 ? "untracked" : i === 9 ? "partial" : "future",
  ...(i === 9 ? { income: "117000", spend: "20000", saved: "97000", budget: "15000" } : {}),
}));
const YEAR = {
  year: 2026, scope: "household", first_entry: "2026-10-18",
  income: "117000", spend: "20000", saved: "97000", savings_rate: 0.829, invested: "2000", lent: "0", repaid: "0",
  budget_to_date: "15000", months,
  groups: [
    { parent_name: "Everyday", total: "12000", months: [...Array(9).fill("0"), "12000", "0", "0"] },
    { parent_name: null, total: "8000", months: [...Array(9).fill("0"), "8000", "0", "0"] },
  ],
  budget_grid: [{ parent_name: "Everyday", months: months.map((m) => ({ budget: m.status === "partial" ? "10000" : null, actual: m.status === "partial" ? "12000" : "0" })) }],
  biggest: [{ id: "t1", date: "2026-10-20", description: "Laptop", amount: "12000", parent_name: "Everyday", sub_name: "Shopping", account_name: "ICICI" }],
  big_count: 1, big_total: "12000", big_threshold: "10000",
  family: [{ parent_name: "Gotu", given: "5000", received: "4000" }],
  card_bills_count: 2, card_bills_total: "3000",
};

function renderYear(body: object = YEAR) {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YearView year={2026} scope="household" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetch;
}

it("shows the year's totals against the budget of the months so far", async () => {
  const fetch = renderYear();
  expect(await screen.findByText(amountText("₹1,17,000.00"))).toBeTruthy();
  expect(String(fetch.mock.calls[0][0])).toBe("/api/v1/stats/year?year=2026&scope=household");
  const glance = screen.getByRole("region", { name: "2026 at a glance" });
  expect(within(glance).getAllByRole("term").map((t) => t.textContent).slice(0, 3)).toEqual(["Income this year", "Spent this year", "Saved this year"]);
  expect(within(glance).getByText(amountText(/of ₹15,000.00 budget so far/)).closest("dd")!.textContent).toBe("of ₹15,000.00 budget so far · ₹5,000.00 over");
  expect(within(glance).getByText(amountText("83% of income ₹1,17,000.00"))).toBeTruthy();
  // Averages count only the one tracked month, not twelve.
  expect(within(glance).getByText("Average spend a month").nextSibling?.textContent).toBe("₹20,000.00");
  expect(screen.getByText(amountText(/Includes 2 entries under Debt › Credit cards \(₹3,000.00\)/))).toBeTruthy();
});

it("says which months aren't in the app instead of counting them as zero", async () => {
  renderYear();
  expect(await screen.findByText("This year starts in the app on 18 Oct.")).toBeTruthy();
  expect(screen.getByText(/January to September aren't in the app/)).toBeTruthy();
  expect(screen.getByText(/1 of 12 months tracked/)).toBeTruthy();
  const chart = screen.getByRole("img", { name: "Income and spending for each month" });
  expect(chart.querySelectorAll(".untracked")).toHaveLength(9);
  expect(chart.querySelectorAll(".future")).toHaveLength(2);
});

it("lists groups with their share and opens a group's months", async () => {
  renderYear();
  const toggle = await screen.findByRole("button", { name: "Everyday" });
  expect(screen.getByRole("button", { name: "No category" })).toBeTruthy();
  expect(toggle.closest("tr")!.textContent).toContain("60%");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const months = toggle.closest("tr")!.nextElementSibling!;
  expect(within(months as HTMLElement).getByText(amountText("₹12,000.00"))).toBeTruthy();
  expect(within(months as HTMLElement).getAllByText("—")).toHaveLength(11);
});

it("shows the biggest expenses, the budget grid and the family cards", async () => {
  renderYear();
  expect(await screen.findByText("Laptop")).toBeTruthy();
  expect(screen.getByText("Everyday › Shopping · 20 Oct · ICICI")).toBeTruthy();
  const row = screen.getByRole("row", { name: /Everyday 120/ });
  expect(row.querySelector(".cell.over")!.textContent).toBe("120");
  expect(row.querySelectorAll(".cell.none")).toHaveLength(9);
  expect(within(row).getByText("over 1 of 1")).toBeTruthy();
  const gotu = screen.getByText("Gotu").closest("li")!;
  expect(gotu.querySelector(".family-given")!.textContent).toBe("₹5,000.00");
  expect(within(gotu).getByText("Received").nextSibling?.textContent).toBe("₹4,000.00");
});

it("hides the budget grid in Just me, since budgets are household-wide", async () => {
  renderYear({ ...YEAR, scope: "me" });
  expect(await screen.findByText("Budgets are household-wide")).toBeTruthy();
  expect(screen.queryByText("Budgets, month by month")).toBeNull();
});

it("switches the dashboard between Month and Year", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/stats/year") ? YEAR : url.includes("/stats/attention")
      ? { month: "2026-10", uncategorized: 0, over_budget: [], old_loans: [], no_income: false, credit_card_category_used: 0 }
      : url.includes("/stats/trend") ? [] : {};
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/?view=year&year=2026"]}>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Income this year")).toBeTruthy();
  expect(screen.getByText("2026")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Month" }));
  expect(await screen.findByText("Spent this month")).toBeTruthy();
});
