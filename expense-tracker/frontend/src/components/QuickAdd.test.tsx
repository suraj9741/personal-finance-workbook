import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { shiftDay, today } from "../format";
import { QuickAdd } from "./QuickAdd";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ME = { id: "u1", email: "s@example.com", display_name: "Suraj", is_site_admin: true, household_id: "h1", household_name: "Home", role: "owner" };
const HDFC = { id: "a1", name: "HDFC", pay_type: "bank", opening_balance: "0", visibility: "shared", owner_user_id: null, is_active: true };
const SUGGESTIONS = [
  { description: "Swiggy", type: "expense", category_id: null, account_id: "a1", amount: "585.00" },
  { description: "Swiggy Instamart", type: "expense", category_id: null, account_id: "a1", amount: "320.00" },
];
const tx = (id: string, date: string, description: string, amount: string) => ({
  id, date, description, amount, type: "expense", account_id: "a1", to_account_id: null, category_id: null,
  cost_basis: null, counterparty: null, notes: null, created_by: "u1", created_by_name: "Suraj", can_edit: true,
});

function setup(days: Record<string, object[]> = {}) {
  const posts: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return new Response(JSON.stringify({ ...tx(`n${posts.length}`, body.date, body.description, body.amount) }), { status: 201 });
    }
    const day = new URL(url, "http://x").searchParams.get("date_from") ?? "";
    const body = url.includes("/suggest") ? SUGGESTIONS
      : url.includes("/transactions") ? { items: days[day] ?? [], total: 0 }
      : url.includes("/accounts") ? [HDFC]
      : url.includes("/auth/me") ? ME
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <QuickAdd />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return posts;
}

it("moves through suggestions with the arrow keys and picks with Enter", async () => {
  setup();
  const input = await screen.findByRole("combobox", { name: "Description" });
  fireEvent.change(input, { target: { value: "sw" } });
  await screen.findByRole("option", { name: /Swiggy Instamart/ });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: /Instamart/ }).getAttribute("aria-selected")).toBe("true");
  expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: /Instamart/ }).id);
  fireEvent.keyDown(input, { key: "Enter" });
  expect((input as HTMLInputElement).value).toBe("Swiggy Instamart");
  expect((screen.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("320.00");
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

it("closes the list on Escape without picking", async () => {
  setup();
  const input = await screen.findByRole("combobox", { name: "Description" });
  fireEvent.change(input, { target: { value: "sw" } });
  await screen.findByRole("option", { name: /Instamart/ });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect((input as HTMLInputElement).value).toBe("sw");
});

it("saves once even when Enter is pressed twice", async () => {
  const posts = setup();
  await screen.findByRole("combobox", { name: "Description" });
  fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "120" } });
  const form = screen.getByRole("form", { name: "Quick add" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(await screen.findByText(/Saved ₹120.00/)).toBeTruthy();
  expect(posts).toHaveLength(1);
});

it("repeats only yesterday's entries that today doesn't have", async () => {
  const now = today();
  const yesterday = shiftDay(now, -1);
  const posts = setup({
    [yesterday]: [tx("y1", yesterday, "Coffee", "50.00"), tx("y2", yesterday, "Coffee", "50.00"), tx("y3", yesterday, "Petrol", "91.00")],
    [now]: [tx("t1", now, "Coffee", "50.00")],
  });
  fireEvent.click(await screen.findByRole("button", { name: "Repeat yesterday's (2)" }));
  expect(await screen.findByText(/Repeated 2 entries from yesterday/)).toBeTruthy();
  await waitFor(() => expect(posts.map((p) => p.description)).toEqual(["Coffee", "Petrol"]));
  expect(posts.every((p) => p.date === now)).toBe(true);
});
