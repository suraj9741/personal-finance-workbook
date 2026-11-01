import { expect, it } from "vitest";
import type { Me } from "./api";
import { ownsAccount } from "./hooks";

const me = (role: "owner" | "member"): Me => ({ id: "u1", email: "a@b", display_name: "A", is_site_admin: false, household_id: "h", household_name: "H", role });

it("counts an account as yours only when you own it, shared or not", () => {
  expect(ownsAccount({ owner_user_id: "u1" }, me("member"))).toBe(true);
  // Someone else's shared account is for seeing, not for adding entries on.
  expect(ownsAccount({ owner_user_id: "u2" }, me("owner"))).toBe(false);
  // An account with no owner falls to the household owner.
  expect(ownsAccount({ owner_user_id: null }, me("owner"))).toBe(true);
  expect(ownsAccount({ owner_user_id: null }, me("member"))).toBe(false);
  expect(ownsAccount({ owner_user_id: "u1" }, null)).toBe(false);
});
