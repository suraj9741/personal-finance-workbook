import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Account, type Category, type Me, type Member, type Rule } from "./api";

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

export const useAccounts = (includeInactive = false) =>
  useQuery({
    queryKey: ["accounts", includeInactive],
    queryFn: () => api<Account[]>(`/accounts${includeInactive ? "?include_inactive=true" : ""}`),
    staleTime: 60_000,
  });

export const useRules = () => useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("/rules") });

export const useMembers = () =>
  useQuery({ queryKey: ["members"], queryFn: () => api<Member[]>("/household/members") });

/** After any money change, refresh lists and every dashboard number. */
export function useRefreshMoney() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ["transactions", "stats", "trend", "attention", "suggest", "rules", "budgets"].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
}
