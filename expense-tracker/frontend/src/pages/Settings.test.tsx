import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Settings } from "./Settings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

const ME = { id: "u1", email: "asha@example.com", display_name: "Asha", is_site_admin: false, household_id: "h1", household_name: "Demo family", role: "owner" };
const cat = (id: string, kind: string, parent_name: string, sub_name: string) => ({
  id, kind, parent_name, sub_name, stats_group: kind === "income" ? "earned" : "spend", is_active: true, sort_order: 0,
});
const CATEGORIES = [cat("c1", "expense", "Everyday", "Food"), cat("c2", "expense", "Everyday", "Snacks"), cat("c3", "income", "Wages", "Paycheck")];
const RULES = [
  { id: "r1", pattern: "swiggy", category_id: "c1", priority: 100, created_by: "u1" },
  { id: "r2", pattern: "zomato", category_id: "c1", priority: 100, created_by: "u2" },
];
const INVITE = { id: "i1", url: "http://localhost:8080/invite/abc", expires_at: "2026-10-25T10:00:00Z", role: "member", household_name: "Demo family" };

function renderSettings({ me = ME, applied = 12 }: { me?: object; applied?: number } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/auth/me") ? me
      : url.includes("/household/members") ? [{ user_id: "u1", display_name: "Asha", email: "asha@example.com", role: "owner", is_active: true }]
      : url.includes("/categories") ? CATEGORIES
      : url.includes("/rules/apply") ? { updated: applied }
      : url.includes("/rules") ? RULES
      : url.includes("/invites") ? INVITE
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function createInvite() {
  renderSettings();
  fireEvent.click(await screen.findByRole("button", { name: "Invite a family member" }));
  return screen.findByRole("textbox", { name: "Invite link" });
}

it("says Copied for a moment after copying the invite link", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await createInvite();
  expect(screen.getByText(/Works once, until 25 Oct\./)).toBeTruthy();

  vi.useFakeTimers();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy" })));
  expect(writeText).toHaveBeenCalledWith(INVITE.url);
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  expect(screen.getByText("Invite link copied").getAttribute("role")).toBe("status");

  act(() => void vi.advanceTimersByTime(2000));
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
});

it("selects the link and says how to copy it when the clipboard refuses", async () => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) }, configurable: true });
  const field = (await createInvite()) as HTMLInputElement;
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy" })));
  expect(document.activeElement).toBe(field);
  expect(screen.getByText("Press ⌘C or Ctrl+C to copy.")).toBeTruthy();
  expect(field.getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
});

it("reports what Apply to uncategorized did, with a link to what's left", async () => {
  renderSettings();
  const status = (await screen.findByText(/Run your rules/)).closest(".card")!.querySelector('.settings-status[role="status"]')!;
  expect(status.textContent).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Apply to uncategorized" }));
  expect(await within(status as HTMLElement).findByText(/Categorized 12 entries\./)).toBeTruthy();
  expect(within(status as HTMLElement).getByRole("link", { name: "See what's still uncategorized" }).getAttribute("href")).toBe("/transactions?uncategorized=true");
});

it("says so when no uncategorized entry matched a rule", async () => {
  renderSettings({ applied: 0 });
  fireEvent.click(await screen.findByRole("button", { name: "Apply to uncategorized" }));
  expect(await screen.findByText(/No uncategorized entries matched a rule\./)).toBeTruthy();
});

it("only offers Edit and Delete on a member's own rules", async () => {
  renderSettings({ me: { ...ME, role: "member" } });
  expect(await screen.findByRole("button", { name: 'Delete rule "swiggy"' })).toBeTruthy();
  expect(screen.getByRole("button", { name: 'Edit rule "swiggy"' })).toBeTruthy();
  expect(screen.queryByRole("button", { name: 'Delete rule "zomato"' })).toBeNull();
  expect(screen.queryByRole("button", { name: 'Edit rule "zomato"' })).toBeNull();
  expect(screen.getByText("Only owners can change categories.")).toBeTruthy();
});

it("moves the category type with the arrow keys, from one Tab stop", async () => {
  renderSettings();
  const group = await screen.findByRole("radiogroup", { name: "Category type" });
  const expense = within(group).getByRole("radio", { name: "Expense" });
  expect(within(group).getAllByRole("radio").map((r) => r.tabIndex)).toEqual([0, -1, -1]);

  fireEvent.keyDown(expense, { key: "ArrowRight" });
  const income = within(group).getByRole("radio", { name: "Income" });
  expect(income.getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(income);
  expect(await screen.findByRole("heading", { name: "Wages" })).toBeTruthy();

  fireEvent.keyDown(income, { key: "ArrowLeft" });
  fireEvent.keyDown(within(group).getByRole("radio", { name: "Expense" }), { key: "ArrowLeft" });
  expect(within(group).getByRole("radio", { name: "Transfer" }).getAttribute("aria-checked")).toBe("true");
});

it("opens the groups that match a search and counts the matches", async () => {
  renderSettings();
  await screen.findByRole("heading", { name: "Everyday" });
  expect(screen.queryByRole("combobox", { name: "Snacks counts as" })).toBeNull();

  fireEvent.change(screen.getByRole("searchbox", { name: "Find a category" }), { target: { value: "snack" } });
  expect(screen.getByRole("combobox", { name: "Snacks counts as" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Food counts as" })).toBeNull();
  expect(screen.getByText("1 category matches").getAttribute("role")).toBe("status");

  fireEvent.change(screen.getByRole("searchbox", { name: "Find a category" }), { target: { value: "paycheck" } });
  expect(screen.getByText(`No categories match "paycheck".`)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show 1 in Income" }));
  const types = screen.getByRole("radiogroup", { name: "Category type" });
  expect(within(types).getByRole("radio", { name: "Income" }).getAttribute("aria-checked")).toBe("true");
});

it("ticks a whole category group as family", async () => {
  renderSettings();
  const group = (await screen.findByRole("heading", { name: "Everyday" })).closest("details")!;
  fireEvent.click(group.querySelector("summary")!);
  const tick = await within(group).findByRole("checkbox", { name: /Family group/ });
  expect((tick as HTMLInputElement).checked).toBe(false);
  fireEvent.click(tick);
  const put = await vi.waitFor(() => {
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    if (!call) throw new Error("no PUT sent");
    return call;
  });
  expect(String(put[0])).toBe("/api/v1/categories/family");
  expect(JSON.parse(String(put[1]!.body))).toEqual({ parent_name: "Everyday", is_family: true });
});

it("renames a whole category group, and says when that covers income too", async () => {
  renderSettings();
  const group = (await screen.findByRole("heading", { name: "Everyday" })).closest("details")!;
  fireEvent.click(group.querySelector("summary")!);
  fireEvent.click(await within(group).findByRole("button", { name: "Rename Everyday" }));
  expect(within(group).queryByText(/Renames it under/)).toBeNull();
  fireEvent.change(within(group).getByRole("textbox", { name: "New name for the Everyday group" }), { target: { value: "Daily" } });
  fireEvent.click(within(group).getByRole("button", { name: "Save" }));
  const put = await vi.waitFor(() => {
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    if (!call) throw new Error("no PUT sent");
    return call;
  });
  expect(String(put[0])).toBe("/api/v1/categories/group-name");
  expect(JSON.parse(String(put[1]!.body))).toEqual({ parent_name: "Everyday", new_name: "Daily" });
});
