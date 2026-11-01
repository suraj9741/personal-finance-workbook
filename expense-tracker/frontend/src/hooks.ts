import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Account, type Category, type Institution, type Me, type Member, type Overview, type Rule } from "./api";

/**
 * The account is yours: you manage it and only you add entries on it. Shared accounts are for
 * the household to see. One with no owner is the household owner's.
 */
export function ownsAccount(account: Pick<Account, "owner_user_id">, me: Me | null | undefined): boolean {
  if (!me) return false;
  return account.owner_user_id ? account.owner_user_id === me.id : me.role === "owner";
}

/** Accounts you can add entries on, from a list of the ones you can see. */
export function useOwnAccounts(accounts: Account[]): Account[] {
  const me = useMe().data;
  return accounts.filter((a) => ownsAccount(a, me));
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export const useCategories = (includeInactive = false) =>
  useQuery({
    queryKey: ["categories", includeInactive],
    queryFn: () => api<Category[]>(`/categories${includeInactive ? "?include_inactive=true" : ""}`),
    staleTime: 60_000,
  });

export const useInstitutions = () =>
  useQuery({
    queryKey: ["institutions"],
    queryFn: () => api<Institution[]>("/institutions"),
    staleTime: 5 * 60_000,
  });

export const useAccounts = (includeInactive = false) =>
  useQuery({
    queryKey: ["accounts", includeInactive],
    queryFn: () => api<Account[]>(`/accounts${includeInactive ? "?include_inactive=true" : ""}`),
    staleTime: 60_000,
  });

/** Every visible account (inactive too) with its balance and the month's activity. */
export const useOverview = (month: string) =>
  useQuery({ queryKey: ["overview", month], queryFn: () => api<Overview>(`/stats/overview?month=${month}`) });

export const useRules = () => useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("/rules") });

export const useMembers = () =>
  useQuery({ queryKey: ["members"], queryFn: () => api<Member[]>("/household/members") });

/** After any money change, refresh lists and every dashboard number. */
export function useRefreshMoney() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ["transactions", "stats", "trend", "attention", "suggest", "rules", "budgets", "overview", "account-summary"].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
}
