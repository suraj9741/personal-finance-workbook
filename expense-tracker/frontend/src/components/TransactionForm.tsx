import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { del, patch, post, type Transaction, type TransactionInput, type TxType } from "../api";
import { TX_TYPE_LABEL, categoryKind, groupOf, money, today } from "../format";
import { forgetDraft, useDraft, useKeepDraft } from "../draft";
import { focusFirstInvalid, invalidProps, splitServerError, type FieldErrors } from "../forms";
import { useAccounts, useCategories, useRefreshMoney } from "../hooks";
import { AccountPicker } from "./AccountPicker";
import { CategoryPicker } from "./CategoryPicker";
import { BusyLabel, DraftNote, FieldError } from "./FormBits";
import { useModal } from "./modal-context";
import { useToasts } from "./toast-context";
import { SegmentedRadio } from "./SegmentedRadio";

const TYPES: TxType[] = ["expense", "income", "transfer", "refund", "buy", "sell"];
const TYPE_HINT: Partial<Record<TxType, string>> = {
  transfer: "Moving your own money: bank to bank, paying a card bill, adding money to a broker. Not income or expense.",
  refund: "Money back on something you bought. Lowers that category's spend (and the card's outstanding).",
  buy: "Shares or funds bought with the broker account's cash. Not an expense.",
  sell: "Shares or funds sold. Not income. Add what they cost to track realized profit.",
};

const FIELDS = ["amount", "date", "account_id", "to_account_id", "category_id", "description", "cost_basis", "counterparty", "notes"];

/** What can be checked before sending; the server checks the rest. */
function validate(form: TransactionInput): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.account_id) errors.account_id = "Choose an account.";
  if (form.type === "transfer") {
    if (!form.to_account_id) errors.to_account_id = "Choose the account the money goes to.";
    else if (form.to_account_id === form.account_id) errors.to_account_id = "Pick a different account from the one it comes from.";
  }
  if (!(Number(form.amount) > 0)) errors.amount = "Enter an amount more than 0.";
  if (!form.date) errors.date = "Pick a date.";
  return errors;
}

interface Props {
  existing?: Transaction;
  /** For a new entry: start on this account (from an account's page). */
  accountId?: string;
  onDone: () => void;
}

/** Every field: type, account (type first), transfers, lending (person), notes. Add or edit. */
export function TransactionForm({ existing, accountId, onDone }: Props) {
  const allAccounts = useAccounts(true).data ?? [];
  // Active accounts, plus inactive ones this entry already uses so editing doesn't lose them.
  const accounts = allAccounts.filter(
    (a) => a.is_active || a.id === existing?.account_id || a.id === existing?.to_account_id,
  );
  const categories = useCategories().data ?? [];
  const refresh = useRefreshMoney();
  // What you typed last time comes back: per entry when editing, per account page when adding.
  const draftKey = existing ? `tx:${existing.id}` : `tx:new${accountId ? `:${accountId}` : ""}`;
  const { base, restored } = useDraft<TransactionInput>(draftKey, {
    date: existing?.date ?? today(),
    amount: existing?.amount ?? "",
    type: existing?.type ?? "expense",
    account_id: existing?.account_id ?? accountId ?? accounts[0]?.id ?? "",
    to_account_id: existing?.to_account_id ?? null,
    category_id: existing?.category_id ?? null,
    description: existing?.description ?? "",
    cost_basis: existing?.cost_basis ?? "",
    counterparty: existing?.counterparty ?? "",
    notes: existing?.notes ?? "",
  }, !!existing);
  const [form, setForm] = useState<TransactionInput>(() => restored ?? (JSON.parse(base) as TransactionInput));
  const [showRestored, setShowRestored] = useState(restored !== null);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Bumped on each failed submit, so the cursor jumps to the problem then and not while typing.
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const modal = useModal();
  const toasts = useToasts();
  const done = modal?.close ?? onDone;
  const set = (changes: Partial<TransactionInput>) => {
    setForm((f) => ({ ...f, ...changes }));
    // A fixed field stops showing its old message.
    setErrors((e) => (Object.keys(changes).some((k) => e[k]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in changes))) : e));
  };

  useKeepDraft(draftKey, base, form);

  function clearDraft() {
    setForm(JSON.parse(base) as TransactionInput);
    setErrors({});
    setShowRestored(false);
    formRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }

  useEffect(() => {
    if (attempt) focusFirstInvalid(formRef.current);
  }, [attempt]);
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
      forgetDraft(draftKey);
      refresh();
      done();
    },
    onError: (e: Error) => {
      const split = splitServerError(e, FIELDS);
      setErrors(split.errors);
      setError(split.general);
      setAttempt((n) => n + 1);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    setError("");
    // Same fallback as the save: accounts can arrive after the form opened with none chosen.
    const found = validate({ ...form, account_id: form.account_id || accounts[0]?.id || "" });
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate();
    else setAttempt((n) => n + 1);
  }

  // Gone from the list at once; the delete is sent when Undo runs out.
  function remove() {
    const t = existing!;
    toasts.deferDelete({
      id: t.id,
      text: `Deleted ${t.description || TX_TYPE_LABEL[t.type]} ${money(t.amount)}`,
      commit: (keepalive) => del(`/transactions/${t.id}`, keepalive),
      after: refresh,
    });
    forgetDraft(draftKey);
    done();
  }

  const busy = save.isPending;
  const field = (name: string) => invalidProps(errors, name, formId);

  return (
    <form ref={formRef} className="tx-form" onSubmit={submit} noValidate aria-busy={busy}>
      {showRestored && <DraftNote onClear={clearDraft} />}
      <SegmentedRadio
        label="Transaction type"
        className="segmented wrap"
        value={form.type}
        onChange={(k) => {
          const changes: Partial<TransactionInput> = { type: k, category_id: null };
          const current = accounts.find((a) => a.id === form.account_id);
          if ((k === "buy" || k === "sell") && current && groupOf(current.pay_type) !== "share_broker")
            changes.account_id = accounts.find((a) => a.pay_type === "share_broker")?.id ?? "";
          set(changes);
        }}
        options={TYPES.map((k) => ({ value: k, label: TX_TYPE_LABEL[k] }))}
      />
      {TYPE_HINT[form.type] && <p className="hint">{TYPE_HINT[form.type]}</p>}
      <fieldset className="plain-fieldset" {...field("account_id")}>
        <legend>{form.type === "transfer" ? "From account" : "Account"}</legend>
        <AccountPicker
          accounts={accounts}
          // Accounts can arrive after the form opens; show the one saving will use (see onSubmit).
          value={form.account_id || accounts[0]?.id || ""}
          label={form.type === "transfer" ? "From" : undefined}
          groups={form.type === "buy" || form.type === "sell" ? ["share_broker"] : undefined}
          onChange={(id) => set({ account_id: id })}
        />
        <FieldError errors={errors} name="account_id" formId={formId} />
      </fieldset>
      {form.type === "transfer" && (
        <fieldset className="plain-fieldset" {...field("to_account_id")}>
          <legend>To account</legend>
          <AccountPicker
            accounts={accounts}
            value={form.to_account_id ?? ""}
            label="To"
            exclude={form.account_id}
            onChange={(id) => set({ to_account_id: id || null })}
          />
          <FieldError errors={errors} name="to_account_id" formId={formId} />
        </fieldset>
      )}
      <label>
        Amount (₹)
        <input inputMode="decimal" required data-autofocus value={form.amount} onChange={(e) => set({ amount: e.target.value })} {...field("amount")} />
        <FieldError errors={errors} name="amount" formId={formId} />
      </label>
      {form.type === "sell" && (
        <label>
          What the sold units cost (₹, optional)
          <input inputMode="decimal" value={form.cost_basis ?? ""} onChange={(e) => set({ cost_basis: e.target.value })} {...field("cost_basis")} />
          <FieldError errors={errors} name="cost_basis" formId={formId} />
        </label>
      )}
      <label>
        Date
        <input type="date" required value={form.date} onChange={(e) => set({ date: e.target.value })} {...field("date")} />
        <FieldError errors={errors} name="date" formId={formId} />
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
        <input value={form.description} maxLength={200} onChange={(e) => set({ description: e.target.value })} {...field("description")} />
        <FieldError errors={errors} name="description" formId={formId} />
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          <BusyLabel busy={busy} idle={existing ? "Save changes" : "Add transaction"} working={existing ? "Saving…" : "Adding…"} />
        </button>
        <button type="button" disabled={busy} onClick={done}>
          Cancel
        </button>
        {existing && (
          <button type="button" className="danger" disabled={busy} onClick={remove}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
