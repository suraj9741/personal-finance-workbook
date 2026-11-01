import { afterEach, expect, it, vi } from "vitest";
import { api, del, post } from "./api";
import { onOtherTabChange } from "./sync";

const respond = (status: number, body: unknown = null) =>
  vi.fn().mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status }));

const settle = () => new Promise((r) => setTimeout(r, 60));

afterEach(() => vi.unstubAllGlobals());

it("tells other open tabs after a save or delete, once per burst", async () => {
  const changed = vi.fn();
  const stop = onOtherTabChange(changed, 20);
  vi.stubGlobal("fetch", respond(201, { id: "t1" }));
  await post("/transactions", { amount: 10 });
  await post("/transactions", { amount: 20 });
  vi.stubGlobal("fetch", respond(204));
  await del("/transactions/t1");
  await settle();
  expect(changed).toHaveBeenCalledTimes(1);
  stop();
});

it("stays quiet for reads and failed saves", async () => {
  const changed = vi.fn();
  const stop = onOtherTabChange(changed, 20);
  vi.stubGlobal("fetch", respond(200, []));
  await api("/accounts");
  vi.stubGlobal("fetch", respond(422, { detail: "amount: must be more than 0" }));
  await expect(post("/transactions", { amount: 0 })).rejects.toThrow();
  await settle();
  expect(changed).not.toHaveBeenCalled();
  stop();
});
