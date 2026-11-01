import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShareSwitch } from "./ShareSwitch";

afterEach(cleanup);

it("is off for a private account and says only you see it", () => {
  const onChange = vi.fn();
  render(<ShareSwitch shared={false} onChange={onChange} />);
  const toggle = screen.getByRole("switch", { name: /Share with household/ }) as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  expect(screen.getByText("Only you see this account and its entries.")).toBeTruthy();
  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith(true);
});

it("explains what sharing means when on", () => {
  render(<ShareSwitch shared onChange={() => {}} />);
  expect(screen.getByText(/Only you can change or delete it/)).toBeTruthy();
});
