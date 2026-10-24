import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SearchPicker, type PickerItem } from "./SearchPicker";

afterEach(cleanup);

const ITEMS: PickerItem[] = [
  { id: "food", label: "Food", group: "Everyday" },
  { id: "pharmacy", label: "Pharmacy", group: "Health" },
  { id: "gotu-pharmacy", label: "Pharmacy", group: "Gotu" },
  { id: "gotu-fuel", label: "Fuel", group: "Gotu" },
];

function Picker({ onChange = () => {} }: { onChange?: (id: string | null) => void }) {
  const [value, setValue] = useState<string | null>("food");
  return (
    <SearchPicker
      label="Category"
      items={ITEMS}
      value={value}
      none="Uncategorized"
      showGroup
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}

const rows = () => within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
const search = () => screen.getByRole("combobox", { name: "Search category" });

it("shows the choice as Group › Item and lists items under their groups", () => {
  render(<Picker />);
  const button = screen.getByRole("button", { name: "Category Everyday › Food" });
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(rows()).toEqual(["Uncategorized", "Food", "Pharmacy", "Pharmacy", "Fuel"]);
  expect(screen.getAllByText(/^(Everyday|Health|Gotu)$/).map((h) => h.textContent)).toEqual(["Everyday", "Health", "Gotu"]);
  expect(within(screen.getByRole("listbox")).getByRole("option", { selected: true }).textContent).toBe("Food");
});

it("finds items by their name or their group", () => {
  render(<Picker />);
  fireEvent.click(screen.getByRole("button", { name: /^Category/ }));
  fireEvent.change(search(), { target: { value: "pharm" } });
  expect(rows()).toEqual(["Pharmacy", "Pharmacy"]);
  fireEvent.change(search(), { target: { value: "gotu" } });
  expect(rows()).toEqual(["Pharmacy", "Fuel"]);
  fireEvent.change(search(), { target: { value: "zzz" } });
  expect(screen.getByText("Nothing matches “zzz”")).toBeTruthy();
});

it("picks with the arrow keys and Enter, then gives focus back to the button", () => {
  const onChange = vi.fn();
  render(<Picker onChange={onChange} />);
  const button = screen.getByRole("button", { name: /^Category/ });
  fireEvent.click(button);
  fireEvent.change(search(), { target: { value: "pharm" } });
  fireEvent.keyDown(search(), { key: "ArrowDown" });
  fireEvent.keyDown(search(), { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith("gotu-pharmacy");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("button", { name: "Category Gotu › Pharmacy" })).toBe(document.activeElement);
});

it("offers the none choice first and closes on Esc without choosing", () => {
  const onChange = vi.fn();
  render(<Picker onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /^Category/ }));
  fireEvent.keyDown(search(), { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^Category/ }));
  fireEvent.click(screen.getByRole("option", { name: "Uncategorized" }));
  expect(onChange).toHaveBeenCalledWith(null);
  expect(screen.getByRole("button", { name: "Category Uncategorized" })).toBeTruthy();
});

it("searches in the field itself, then fades the list out before removing it", async () => {
  const { container } = render(<Picker />);
  fireEvent.click(screen.getByRole("button", { name: /^Category/ }));
  // The search box takes the button's place and shows the current choice until you type.
  expect(search().closest(".search-picker")).toBe(container.querySelector(".search-picker"));
  expect(search().getAttribute("placeholder")).toBe("Everyday › Food");
  expect(container.querySelector(".search-picker-pop input")).toBeNull();
  fireEvent.keyDown(search(), { key: "Escape" });
  // Still drawn while it fades, but hidden from screen readers and not clickable.
  const pop = container.querySelector(".search-picker-pop");
  expect(pop?.classList.contains("leaving")).toBe(true);
  expect(pop?.getAttribute("aria-hidden")).toBe("true");
  await waitFor(() => expect(container.querySelector(".search-picker-pop")).toBeNull());
});

it("closes after a pick when it sits inside a label, as in the full form", () => {
  render(
    <label>
      Category <Picker />
    </label>,
  );
  const button = screen.getByRole("button", { name: /^Category/ });
  fireEvent.click(button);
  // A browser would pass a click the picker didn't cancel on to the label's button, reopening the list.
  const passedOn = fireEvent.click(within(screen.getByRole("listbox")).getByText("Fuel"));
  expect(passedOn).toBe(false);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.textContent).toContain("Gotu › Fuel");
});
