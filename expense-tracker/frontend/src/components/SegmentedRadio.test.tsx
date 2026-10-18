import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { SegmentedRadio } from "./SegmentedRadio";

afterEach(cleanup);

function Picker() {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <SegmentedRadio
      label="Pick"
      value={value}
      onChange={setValue}
      options={[
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
        { value: "c", label: "Gamma" },
      ]}
    />
  );
}

it("moves the choice with arrows, Home and End, with Tab landing on the chosen one", () => {
  render(<Picker />);
  const radio = (name: string) => screen.getByRole("radio", { name });
  expect(radio("Alpha").tabIndex).toBe(0);
  expect(radio("Beta").tabIndex).toBe(-1);
  fireEvent.keyDown(radio("Alpha"), { key: "ArrowRight" });
  expect(radio("Beta").getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(radio("Beta"));
  fireEvent.keyDown(radio("Beta"), { key: "End" });
  expect(radio("Gamma").getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(radio("Gamma"), { key: "ArrowRight" });
  expect(radio("Alpha").getAttribute("aria-checked")).toBe("true");
});

it("lets the highlight slide only after it has been placed once", async () => {
  render(<Picker />);
  const group = screen.getByRole("radiogroup", { name: "Pick" });
  // Placed at first paint without moving, so it never flies in as the page opens.
  expect(group.hasAttribute("data-ready")).toBe(false);
  expect(group.querySelector(".segmented-thumb")!.getAttribute("aria-hidden")).toBe("true");
  await act(() => new Promise((done) => requestAnimationFrame(() => done(undefined))));
  expect(group.hasAttribute("data-ready")).toBe(true);
  // Text labels carry their own name, so the bold width can be held in reserve.
  expect(screen.getByRole("radio", { name: "Beta" }).dataset.label).toBe("Beta");
});
