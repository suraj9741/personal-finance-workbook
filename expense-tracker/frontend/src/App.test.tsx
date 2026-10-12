import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ME = { id: "u1", email: "s@example.com", display_name: "Suraj", is_site_admin: true, household_id: "h1", household_name: "Home", role: "owner" };
const HDFC = { id: "a1", name: "HDFC", pay_type: "bank", opening_balance: "0", visibility: "shared", owner_user_id: null, is_active: true };

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
  expect(within(welcome).getByRole("link", { name: "Settings" })).toBeTruthy();
  expect(screen.queryByRole("form", { name: "Quick add" })).toBeNull();
});

it("shows budget, spent and diff for expense and income", async () => {
  const cat = (id: string, kind: string, parent_name: string, sub_name: string) => ({ id, kind, parent_name, sub_name, stats_group: kind === "income" ? "earned" : "spend", is_active: true, sort_order: 0 });
  const categories = [cat("c1", "expense", "Everyday", "Food"), cat("c2", "expense", "Debt", "Tax"), cat("c3", "income", "Wages", "Paycheck")];
  const line = (category_id: string, kind: string, actual: string) => ({ category_id, kind, parent_name: "", sub_name: "", stats_group: "spend", budget: null, actual, diff: "0", over_budget: false });
  const stats = { month: "2026-10", scope: "household", income: "52000", spend: "1200", saved: "0", savings_rate: null, invested: "0", lent: "0", repaid: "0", budget_total: "3000", categories: [line("c1", "expense", "1200"), line("c3", "income", "52000")] };
  const budgets = { month: "2026-10", carries_forward: true, items: [{ category_id: "c1", amount: "3000.00", this_month_only: false, set_in: "2026-09" }, { category_id: "c3", amount: "50000.00", this_month_only: false, set_in: "2026-10" }] };
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
  expect(screen.getByText("since September 2026")).toBeTruthy();
  expect(within(screen.getByLabelText("Expense totals")).getByText("₹1,800")).toBeTruthy();
});
