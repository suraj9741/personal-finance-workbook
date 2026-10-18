import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Icon } from "./Icon";

afterEach(cleanup);

it("is decoration beside words, and an image only when it carries a label", () => {
  const { container } = render(
    <p>
      <Icon name="check" /> Saved <Icon name="close" label="Close" />
    </p>,
  );
  const [plain] = container.querySelectorAll("svg");
  expect(plain.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByRole("img", { name: "Close" })).toBeTruthy();
});
