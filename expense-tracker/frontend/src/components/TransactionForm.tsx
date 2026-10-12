import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { del, patch, post, type Kind, type Transaction, type TransactionInput } from "../api";
import { today } from "../format";
import { useAccounts, useCategories, useRefreshMoney } from "../hooks";
import { CategoryPicker } from "./CategoryPicker";

interface Props {
  existing?: Transaction;
  onDone: () => void;
}

/** Every field: transfers (from/to), lending (person), notes. Add or edit. */
export function TransactionForm({ existing, onDone }: Props) {
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const refresh = useRefreshMoney();
  const [form, setForm] = useState<TransactionInput>(() => ({
    date: existing?.date ?? today(),
    amount: existing?.amount ?? "",
    type: existing?.type ?? "expense",
    account_id: existing?.account_id ?? accounts[0]?.id ?? "",
    to_account_id: existing?.to_account_id ?? null,
    category_id: existing?.category_id ?? null,
    description: existing?.description ?? "",
    counterparty: existing?.counterparty ?? "",
    notes: existing?.notes ?? "",
  }));
  const [error, setError] = useState("");
  const set = (changes: Partial<TransactionInput>) => setForm((f) => ({ ...f, ...changes }));
  const category = categories.find((c) => c.id === form.category_id);
  const needsPerson = category?.stats_group === "lent" || category?.stats_group === "repaid";

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        account_id: form.account_id || accounts[0]?.id,
        to_account_id: form.type === "transfer" ? form.to_account_id : null,
        counterparty: form.counterparty || null,
        notes: form.notes || null,
      };
      return existing ? patch(`/transactions/${existing.id}`, body) : post("/transactions", body);
    },
    onSuccess: () => {
      refresh();
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => del(`/transactions/${existing!.id}`),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    save.mutate();
  }

  return (
    <form className="tx-form" onSubmit={submit}>
      <div className="segmented" role="radiogroup" aria-label="Type">
        {(["expense", "income", "transfer"] as Kind[]).map((k) => (
          <button
            type="button"
            key={k}
            role="radio"
            aria-checked={form.type === k}
            className={form.type === k ? "active" : ""}
            onClick={() => set({ type: k, category_id: null })}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <label>
        Amount (₹)
        <input inputMode="decimal" required value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
      </label>
      <label>
        Date
        <input type="date" required value={form.date} onChange={(e) => set({ date: e.target.value })} />
      </label>
      <label>
        {form.type === "transfer" ? "From account" : "Account"}
        <select value={form.account_id} onChange={(e) => set({ account_id: e.target.value })}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {form.type === "transfer" && (
        <label>
          To account
          <select value={form.to_account_id ?? ""} onChange={(e) => set({ to_account_id: e.target.value || null })}>
            <option value="">Choose…</option>
            {accounts
              .filter((a) => a.id !== form.account_id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        Category
        <CategoryPicker
          categories={categories}
          kind={form.type}
          value={form.category_id ?? null}
          onChange={(id) => set({ category_id: id })}
        />
      </label>
      {category?.parent_name === "Debt" && category.sub_name === "Credit cards" && (
        <p className="hint">
          Paying a card bill with this category counts your card spends twice. Use Transfer › Self Transfer › Bank to
          Credit instead.
        </p>
      )}
      <label>
        Description
        <input value={form.description} maxLength={200} onChange={(e) => set({ description: e.target.value })} />
      </label>
      {(needsPerson || form.counterparty) && (
        <label>
          Person
          <input value={form.counterparty ?? ""} onChange={(e) => set({ counterparty: e.target.value })} />
        </label>
      )}
      <label>
        Notes
        <textarea rows={2} value={form.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={save.isPending}>
          {existing ? "Save changes" : "Add transaction"}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        {existing && (
          <button
            type="button"
            className="danger"
            onClick={() => window.confirm("Delete this transaction?") && remove.mutate()}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
