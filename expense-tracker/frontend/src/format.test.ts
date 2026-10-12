import { describe, expect, it } from "vitest";
import { money, percent, shiftMonth } from "./format";

describe("format", () => {
  it("uses Indian digit grouping", () => {
    expect(money("108811")).toBe("₹1,08,811");
    expect(money(null)).toBe("—");
  });
  it("shifts months across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("formats savings rate", () => {
    expect(percent(0.756)).toBe("76%");
    expect(percent(null)).toBe("—");
  });
});
