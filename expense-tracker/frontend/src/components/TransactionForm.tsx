import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { del, patch, post, type Transaction, type TransactionInput, type TxType } from "../api";
import { TX_TYPE_LABEL, categoryKind, groupOf, today } from "../format";
import { useAccounts, useCategories, useRefreshMoney } from "../hooks";
import { AccountPicker } from "./AccountPicker";
import { CategoryPicker } from "./CategoryPicker";

const TYPES: TxType[] = ["expense", "income", "transfer", "refund", "buy", "sell"];
const TYPE_HINT: Partial<Record<TxType, string>> = {
  transfer: "Moving your own money: bank to bank, paying a card bill, adding money to a broker. Not income or expense.",
  refund: "Money back on something you bought. Lowers that category's spend (and the card's outstanding).",
  buy: "Shares or funds bought with the broker account's cash. Not an expense.",
  sell: "Shares or funds sold. Not income. Add what they cost to track realized profit.",
};

interface Props {
  existing?: Transaction;
  onDone: () => void;
}

/** Every field: type, account (type first), transfers, lending (person), notes. Add or edit. */
export function TransactionForm({ existing, onDone }: Props) {
  const allAccounts = useAccounts(true).data ?? [];
  // Active accounts, plus inactive ones this entry already uses so editing doesn't lose them.
  const accounts = allAccounts.filter(
    (a) => a.is_active || a.id === existing?.account_id || a.id === existing?.to_account_id,
  );
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
    cost_basis: existing?.cost_basis ?? "",
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
        category_id: categoryKind(form.type) ? form.category_id : null,
        cost_basis: form.type === "sell" && form.cost_basis ? form.cost_basis : null,
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
      <div className="segmented wrap" role="radiogroup" aria-label="Transaction type">
        {TYPES.map((k) => (
          <button
            type="button"
            key={k}
            role="radio"
            aria-checked={form.type === k}
            className={form.type === k ? "active" : ""}
            onClick={() => {
              const changes: Partial<TransactionInput> = { type: k, category_id: null };
              const current = accounts.find((a) => a.id === form.account_id);
              if ((k === "buy" || k === "sell") && current && groupOf(current.pay_type) !== "share_broker")
                changes.account_id = accounts.find((a) => a.pay_type === "share_broker")?.id ?? "";
              set(changes);
            }}
          >
            {TX_TYPE_LABEL[k]}
          </button>
        ))}
      </div>
      {TYPE_HINT[form.type] && <p className="hint">{TYPE_HINT[form.type]}</p>}
      <fieldset className="plain-fieldset">
        <legend>{form.type === "transfer" ? "From account" : "Account"}</legend>
        <AccountPicker
          accounts={accounts}
          value={form.account_id}
          label={form.type === "transfer" ? "From" : undefined}
          groups={form.type === "buy" || form.type === "sell" ? ["share_broker"] : undefined}
          onChange={(id) => set({ account_id: id })}
        />
      </fieldset>
      {form.type === "transfer" && (
        <fieldset className="plain-fieldset">
          <legend>To account</legend>
          <AccountPicker
            accounts={accounts}
            value={form.to_account_id ?? ""}
            label="To"
            exclude={form.account_id}
            onChange={(id) => set({ to_account_id: id || null })}
          />
        </fieldset>
      )}
      <label>
        Amount (₹)
        <input inputMode="decimal" required value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
      </label>
      {form.type === "sell" && (
        <label>
          What the sold units cost (₹, optional)
          <input inputMode="decimal" value={form.cost_basis ?? ""} onChange={(e) => set({ cost_basis: e.target.value })} />
        </label>
      )}
      <label>
        Date
        <input type="date" required value={form.date} onChange={(e) => set({ date: e.target.value })} />
      </label>
      {categoryKind(form.type) && (
        <label>
          Category
          <CategoryPicker
            categories={categories}
            kind={categoryKind(form.type)!}
            value={form.category_id ?? null}
            onChange={(id) => set({ category_id: id })}
          />
        </label>
      )}
      {category?.parent_name === "Debt" && category.sub_name === "Credit cards" && (
        <p className="hint">
          Paying a card bill with this category counts your card spends twice. Use a Transfer from the bank to the card
          instead.
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
