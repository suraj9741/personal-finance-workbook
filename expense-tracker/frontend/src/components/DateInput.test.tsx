import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { formatDay, readTypedDay } from "../format";
import { DateInput } from "./DateInput";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Field({ start = "2026-10-24", onChange = () => {}, min }: { start?: string; onChange?: (iso: string) => void; min?: string }) {
  const [value, setValue] = useState(start);
  return (
    <DateInput
      aria-label="Date"
      required
      min={min}
      value={value}
      onChange={(iso) => {
        setValue(iso);
        onChange(iso);
      }}
    />
  );
}

const field = () => screen.getByLabelText("Date") as HTMLInputElement;

it("reads dates day first, with or without separators", () => {
  expect(readTypedDay("22/10/2026")).toBe("2026-10-22");
  expect(readTypedDay("2-1-26")).toBe("2026-01-02");
  expect(readTypedDay("22102026")).toBe("2026-10-22");
  expect(readTypedDay("221026")).toBe("2026-10-22");
  expect(readTypedDay("31/02/2026")).toBeNull();
  expect(readTypedDay("22/10")).toBeNull();
  expect(formatDay("2026-10-05")).toBe("05/10/2026");
});

it("opens the calendar on a click in the field and still takes typing", () => {
  const onChange = vi.fn();
  render(<Field onChange={onChange} />);
  expect(field().value).toBe("24/10/2026");
  fireEvent.click(field());
  expect(screen.getByRole("dialog", { name: "Calendar" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "24/10/2026" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.change(field(), { target: { value: "22102026" } });
  expect(onChange).toHaveBeenLastCalledWith("2026-10-22");
  // The calendar follows what's typed.
  expect(screen.getByRole("button", { name: "22/10/2026" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.blur(field());
  expect(field().value).toBe("22/10/2026");
});

it("picks a day from the calendar, across months, then closes", () => {
  const onChange = vi.fn();
  render(<Field onChange={onChange} />);
  fireEvent.click(field());
  expect(screen.getByRole("dialog").textContent).toContain("October 2026");
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(screen.getByRole("dialog").textContent).toContain("September 2026");
  fireEvent.click(screen.getByRole("button", { name: "15/09/2026" }));
  expect(onChange).toHaveBeenLastCalledWith("2026-09-15");
  expect(field().value).toBe("15/09/2026");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps the last real date when what was typed isn't one", () => {
  const onChange = vi.fn();
  render(<Field onChange={onChange} />);
  fireEvent.change(field(), { target: { value: "31/02" } });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.blur(field());
  expect(field().value).toBe("24/10/2026");
});

it("closes on Esc, and days before the minimum can't be picked", () => {
  render(<Field min="2026-10-20" />);
  fireEvent.click(field());
  expect((screen.getByRole("button", { name: "19/10/2026" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "20/10/2026" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(field(), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("marks today in the calendar", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 24, 12));
  render(<Field start="2026-10-05" />);
  fireEvent.click(field());
  expect(screen.getByRole("button", { name: "24/10/2026" }).getAttribute("aria-current")).toBe("date");
});
