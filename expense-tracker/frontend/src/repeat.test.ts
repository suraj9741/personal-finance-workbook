import { expect, it } from "vitest";
import { stillToRepeat } from "./repeat";

const tx = (description: string, amount: string, type = "expense" as "expense" | "income" | "transfer") => ({
  type, amount, description, account_id: "a1", category_id: "c1",
});

it("repeats only what today doesn't already have", () => {
  const yesterday = [tx("Swiggy", "585.00"), tx("Petrol", "91.00")];
  expect(stillToRepeat(yesterday, [tx("Swiggy", "585")])).toEqual([tx("Petrol", "91.00")]);
});

it("counts copies, so two identical coffees both repeat", () => {
  const coffee = tx("Coffee", "50.00");
  expect(stillToRepeat([coffee, coffee], [])).toHaveLength(2);
  expect(stillToRepeat([coffee, coffee], [coffee])).toHaveLength(1);
});

it("adds nothing on a second run", () => {
  const yesterday = [tx("Coffee", "50.00"), tx("Coffee", "50.00"), tx("Salary", "1000.00", "income")];
  expect(stillToRepeat(yesterday, yesterday)).toEqual([]);
});

it("never repeats transfers", () => {
  expect(stillToRepeat([tx("Card bill", "5000.00", "transfer")], [])).toEqual([]);
});
