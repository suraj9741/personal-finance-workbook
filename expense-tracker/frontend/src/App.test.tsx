import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => vi.restoreAllMocks());

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
  const me = { id: "u1", email: "s@example.com", display_name: "Suraj", is_site_admin: true, household_id: "h1", household_name: "Home", role: "owner" };
  const stats = { month: "2026-10", scope: "household", income: "100000", spend: "40000", saved: "60000", savings_rate: 0.6, invested: "0", lent: "0", repaid: "0", budget_total: "0", categories: [] };
  const attention = { month: "2026-10", uncategorized: 2, over_budget: [], old_loans: [], no_income: false, credit_card_category_used: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/auth/me") ? me
      : url.includes("/stats/month") ? stats
      : url.includes("/stats/attention") ? attention
      : url.includes("/transactions") ? { items: [], total: 0 }
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  renderAt("/");
  expect(await screen.findByText("₹60,000")).toBeTruthy();
  expect(screen.getByRole("form", { name: "Quick add" })).toBeTruthy();
  expect(await screen.findByText("2 entries have no category")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Admin" })).toBeTruthy();
});
