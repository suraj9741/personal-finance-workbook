import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { MonthPicker } from "./MonthPicker";

afterEach(cleanup);

function Picker() {
  const [month, setMonth] = useState("2026-10");
  return <MonthPicker month={month} onChange={setMonth} />;
}

const nameButton = () => screen.getByRole("button", { name: /^Month:/ });

it("names the month once, and the arrows step a month", () => {
  const { container } = render(<Picker />);
  expect(container.textContent?.match(/October 2026/g)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(nameButton().textContent).toBe("November 2026");
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(nameButton().textContent).toBe("September 2026");
});

it("jumps to any month of any year from the grid, then closes", () => {
  render(<Picker />);
  fireEvent.click(nameButton());
  expect(nameButton().getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "October 2026" }).getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "October 2026" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
  fireEvent.click(screen.getByRole("button", { name: "March 2025" }));
  expect(nameButton().textContent).toBe("March 2025");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(nameButton());
});

it("moves with the arrow keys and closes on Esc without changing the month", () => {
  render(<Picker />);
  fireEvent.click(nameButton());
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "December 2026" }));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "November 2026" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(nameButton().textContent).toBe("October 2026");
});

it("closes on a press outside", () => {
  render(<Picker />);
  fireEvent.click(nameButton());
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
});
