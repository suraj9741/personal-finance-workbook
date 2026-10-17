import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Modal } from "./Modal";
import { TransactionForm } from "./TransactionForm";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HDFC = { id: "a1", name: "HDFC", pay_type: "bank", opening_balance: "0", visibility: "shared", owner_user_id: null, is_active: true };

function Page() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Full form
      </button>
      {open && (
        <Modal title="Add transaction" onClose={() => setOpen(false)}>
          <TransactionForm onDone={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}

function setup() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const body = String(input).includes("/accounts") ? [HDFC] : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
  const opener = screen.getByRole("button", { name: "Full form" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

it("puts the cursor in Amount and returns it to the opener on close", () => {
  const opener = setup();
  const dialog = screen.getByRole("dialog", { name: "Add transaction" });
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Amount (₹)" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(dialog.isConnected).toBe(false);
  expect(document.activeElement).toBe(opener);
});

it("asks before throwing away typed changes", () => {
  setup();
  fireEvent.change(screen.getByRole("textbox", { name: "Amount (₹)" }), { target: { value: "585" } });
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.getByText("Discard your changes?")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep editing" }));

  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByText("Discard your changes?")).toBeNull();
  expect(screen.getByRole("dialog")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows problems under the field and moves the cursor there", async () => {
  setup();
  await screen.findByText("HDFC");
  fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
  const amount = screen.getByRole("textbox", { name: "Amount (₹)" });
  expect(amount.getAttribute("aria-invalid")).toBe("true");
  const message = document.getElementById(amount.getAttribute("aria-describedby")!);
  expect(message?.textContent).toBe("Enter an amount more than 0.");
  expect(document.activeElement).toBe(amount);
  // Fixing the field clears its message.
  fireEvent.change(amount, { target: { value: "10" } });
  expect(amount.getAttribute("aria-invalid")).toBeNull();
});
