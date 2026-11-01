import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BankPicker } from "./BankPicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPicker(value: string, onChange = vi.fn()) {
  const posted: unknown[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "i1", name: "Kotak" }), { status: 201 });
    }
    return new Response(JSON.stringify(String(input).endsWith("/institutions") ? [{ id: "i0", name: "Axis Bank" }] : []), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BankPicker label="Bank name" value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange, posted };
}

it("lists the built-in banks and the ones people added, each with its logo", async () => {
  renderPicker("");
  fireEvent.click(screen.getByRole("button", { name: /Bank name/ }));
  expect(await screen.findByRole("option", { name: /Axis Bank/ })).toBeTruthy();
  expect(screen.getByRole("option", { name: /HDFC Bank/ })).toBeTruthy();
  expect(screen.getByRole("option", { name: /Add a bank with its logo/ })).toBeTruthy();
});

it("adds a bank with an uploaded logo and picks it", async () => {
  const { onChange, posted } = renderPicker("");
  fireEvent.click(screen.getByRole("button", { name: /Bank name/ }));
  fireEvent.click(await screen.findByRole("option", { name: /Add a bank with its logo/ }));
  fireEvent.change(screen.getByPlaceholderText("e.g. Kotak Mahindra Bank"), { target: { value: "Kotak" } });
  const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "kotak.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Logo image"), { target: { files: [png] } });
  await screen.findByAltText("Logo preview");
  fireEvent.click(screen.getByRole("button", { name: "Add bank" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith("Kotak"));
  expect(posted[0]).toMatchObject({ name: "Kotak", logo: expect.stringMatching(/^data:image\/png;base64,/) });
});

it("refuses a logo that isn't PNG, JPEG or WebP", async () => {
  renderPicker("");
  fireEvent.click(screen.getByRole("button", { name: /Bank name/ }));
  fireEvent.click(await screen.findByRole("option", { name: /Add a bank with its logo/ }));
  const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
  fireEvent.change(screen.getByLabelText("Logo image"), { target: { files: [svg] } });
  expect((await screen.findByRole("alert")).textContent).toBe("Use a PNG, JPEG or WebP image.");
});
