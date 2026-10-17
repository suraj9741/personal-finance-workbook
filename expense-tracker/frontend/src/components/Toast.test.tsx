import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "./Toast";
import { UNDO_MS, useToasts } from "./toast-context";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Rows({ commit }: { commit: () => Promise<unknown> }) {
  const { hidden, deferDelete } = useToasts();
  return (
    <>
      {!hidden.has("t1") && <p>Swiggy row</p>}
      <button type="button" onClick={() => deferDelete({ id: "t1", text: "Deleted Swiggy ₹585", commit })}>
        Delete
      </button>
    </>
  );
}

function setup(commit = vi.fn(() => Promise.resolve())) {
  render(
    <ToastProvider>
      <Rows commit={commit} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  return commit;
}

it("hides the row at once and sends nothing when Undo is pressed", async () => {
  const commit = setup();
  expect(screen.queryByText("Swiggy row")).toBeNull();
  expect(screen.getByText("Deleted Swiggy ₹585")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await act(async () => vi.advanceTimersByTime(UNDO_MS * 2));
  expect(commit).not.toHaveBeenCalled();
  expect(screen.getByText("Swiggy row")).toBeTruthy();
});

it("sends the delete when Undo runs out", async () => {
  const commit = setup();
  await act(async () => vi.advanceTimersByTime(UNDO_MS - 1));
  expect(commit).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(commit).toHaveBeenCalledWith(false);
  expect(screen.queryByText("Deleted Swiggy ₹585")).toBeNull();
});

it("pauses while the pointer is on the toast", async () => {
  const commit = setup();
  fireEvent.mouseEnter(screen.getByRole("status"));
  await act(async () => vi.advanceTimersByTime(UNDO_MS * 2));
  expect(commit).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole("status"));
  await act(async () => vi.advanceTimersByTime(UNDO_MS));
  expect(commit).toHaveBeenCalledTimes(1);
});

it("puts the row back and says why when the delete fails", async () => {
  setup(vi.fn(() => Promise.reject(new Error("Category is used by transactions"))));
  await act(async () => vi.advanceTimersByTime(UNDO_MS));
  expect(screen.getByText("Swiggy row")).toBeTruthy();
  expect(screen.getByText(/Couldn't delete: Category is used by transactions/)).toBeTruthy();
});

it("undoes the newest toast with Cmd+Z", async () => {
  const commit = setup();
  fireEvent.keyDown(window, { key: "z", metaKey: true });
  await act(async () => vi.advanceTimersByTime(UNDO_MS * 2));
  expect(commit).not.toHaveBeenCalled();
  expect(screen.getByText("Swiggy row")).toBeTruthy();
});
