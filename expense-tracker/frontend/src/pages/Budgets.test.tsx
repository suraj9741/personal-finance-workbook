import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toast";
import { Budgets } from "./Budgets";

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const ME = { id: "u1", email: "s@example.com", display_name: "Suraj", is_site_admin: false, household_id: "h1", household_name: "Home", role: "owner" };
const CATEGORIES = [
  { id: "c1", kind: "expense", parent_name: "Everyday", sub_name: "Food", stats_group: "spend", is_active: true, sort_order: 0 },
  { id: "c2", kind: "expense", parent_name: "Everyday", sub_name: "Groceries", stats_group: "spend", is_active: true, sort_order: 1 },
];

/** Budgets for October 2026: Food has ₹3,000 saved. Past months don't carry forward. */
function setup(path = "/budgets?month=2026-10") {
  const puts: { month: string; items: { category_id: string; amount: string; this_month_only: boolean }[] }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const month = new URL(url, "http://x").searchParams.get("month") ?? "";
    if (init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ month, carries_forward: true, items: [], next_changes: [] }), { status: 200 });
    }
    const items = month === "2026-10" ? [{ category_id: "c1", amount: "3000.00", this_month_only: false, set_in: "2026-10" }] : [];
    const body = url.includes("/auth/me") ? ME
      : url.includes("/budgets") ? { month, carries_forward: month >= "2026-10", items, next_changes: [] }
      : url.includes("/categories") ? CATEGORIES
      : url.includes("/stats/month") ? { month, categories: [{ category_id: "c1", actual: "1200" }] }
      : url.includes("/stats/attention") ? { month, uncategorized: month === "2026-10" ? 3 : 0 }
      : null;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Budgets />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return puts;
}

const field = async (name: string) => (await screen.findByLabelText(`Everyday ${name} budget`)) as HTMLInputElement;
const bar = () => screen.getByRole("region", { name: "Unsaved budgets" });

it("shows each line in words, with a link to its entries and a note about uncounted entries", async () => {
  setup();
  const food = (await field("Food")).closest(".budget-line")!;
  expect(food.querySelector(".budget-status")!.textContent).toBe("₹1,800 left");
  expect(food.querySelector(".budget-caption")!.textContent).toBe("₹1,200 spent · ₹1,800 left");
  expect(within(food as HTMLElement).getByRole("link", { name: "Food" }).getAttribute("href")).toBe("/transactions?month=2026-10&category_id=c1");
  expect((await field("Groceries")).closest(".budget-line")!.textContent).toContain("No budget");
  expect(screen.getByText("₹1,800 left of ₹3,000")).toBeTruthy();
  expect((await screen.findByRole("link", { name: "Categorize them" })).getAttribute("href")).toBe("/transactions?month=2026-10&uncategorized=true");
});

it("points out unsaved changes in another month and switches to it", async () => {
  setup();
  fireEvent.change(await field("Food"), { target: { value: "5000" } });
  expect((await field("Food")).closest(".budget-line")!.hasAttribute("data-dirty")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect((await field("Food")).value).toBe("");
  expect(within(bar()).getByText("No changes for November 2026")).toBeTruthy();
  fireEvent.click(within(bar()).getByRole("button", { name: "October 2026 (1)" }));
  await waitFor(async () => expect((await field("Food")).value).toBe("5000"));
  expect(within(bar()).getByText("1 change for October 2026")).toBeTruthy();
});

it("discards at once and brings the changes back with Undo", async () => {
  setup();
  fireEvent.change(await field("Food"), { target: { value: "5000" } });
  fireEvent.change(await field("Groceries"), { target: { value: "2000" } });
  fireEvent.click(within(bar()).getByRole("button", { name: "Discard" }));
  expect((await field("Food")).value).toBe("3000");
  expect(screen.queryByRole("region", { name: "Unsaved budgets" })).toBeNull();
  // Focus stays on the last field typed in, not lost with the bar.
  expect(document.activeElement).toBe(await field("Groceries"));
  expect(screen.getByText("Discarded 2 changes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () => expect((await field("Food")).value).toBe("5000"));
  expect((await field("Groceries")).value).toBe("2000");
});

it("flags an amount that isn't a number and won't save until it's fixed", async () => {
  const puts = setup();
  const food = await field("Food");
  fireEvent.change(food, { target: { value: "5.0.0" } });
  expect(food.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("Enter a number, like 5000.")).toBeTruthy();
  expect(within(bar()).getByText("Fix 1 amount to save")).toBeTruthy();
  expect((within(bar()).getByRole("button", { name: "Save budgets" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(food.closest("form")!);
  expect(puts).toEqual([]);
  // Esc puts the saved amount back.
  fireEvent.keyDown(food, { key: "Escape" });
  expect(food.value).toBe("3000");
  expect(food.hasAttribute("aria-invalid")).toBe(false);
});

it("saves for this month only when that's the choice in the bar", async () => {
  const puts = setup();
  const food = await field("Food");
  fireEvent.change(food, { target: { value: "4500" } });
  const later = within(bar()).getByRole("button", { name: "October and later" });
  expect(later.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(bar()).getByRole("button", { name: "October only" }));
  fireEvent.submit(food.closest("form")!);
  expect(await screen.findByText("Budgets saved for October 2026 only.")).toBeTruthy();
  expect(puts).toEqual([{ month: "2026-10", items: [{ category_id: "c1", amount: "4500", this_month_only: true }] }]);
  expect(screen.queryByRole("region", { name: "Unsaved budgets" })).toBeNull();
});

it("says a past month saves for that month only, with no choice", async () => {
  setup("/budgets?month=2025-09");
  fireEvent.change(await field("Food"), { target: { value: "100" } });
  expect(within(bar()).getByText("Past month: saves for September 2025 only")).toBeTruthy();
  expect(within(bar()).queryByRole("group", { name: "Apply to" })).toBeNull();
});
