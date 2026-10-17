import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, del, patch, post, type Account, type PayType } from "../api";
import { ACCOUNT_GROUPS, GROUP_ICON, GROUP_LABEL, groupOf, type AccountGroup } from "../format";
import { forgetDraft, useDraft, useKeepDraft } from "../draft";
import { focusFirstInvalid, invalidProps, splitServerError, type FieldErrors } from "../forms";
import { useMe } from "../hooks";
import { BusyLabel, DraftNote, FieldError } from "./FormBits";
import { useModal } from "./modal-context";
import { useToasts } from "./toast-context";

interface Props {
  existing?: Account;
  /** Preselected type for a new account. */
  group?: AccountGroup;
  onDone: () => void;
  /** After a delete (the account's own page leaves for the list). */
  onDeleted?: () => void;
}

const FIELDS = ["name", "institution", "description", "opening_balance", "opening_date", "credit_limit", "statement_day", "due_day", "opening_invested", "current_value", "valued_on"];
const isAmount = (v: string) => v.trim() === "" || !Number.isNaN(Number(v));
const isDay = (v: string) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 31);

const INSTITUTION_LABEL: Record<AccountGroup, string> = {
  bank: "Bank name",
  credit_card: "Card issuer",
  share_broker: "Broker name",
};
const OPENING_LABEL: Record<AccountGroup, string> = {
  bank: "Opening balance (₹)",
  credit_card: "Amount owed on the opening date (₹)",
  share_broker: "Cash in the broker account on the opening date (₹)",
};

const text = (value: string | null | undefined) => value ?? "";
const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

/** Create or edit an account. The type is fixed once created: past entries depend on it. */
export function AccountForm({ existing, group: initialGroup = "bank", onDone, onDeleted }: Props) {
  const me = useMe().data;
  const isOwner = me?.role === "owner";
  const client = useQueryClient();
  const draftKey = existing ? `account:${existing.id}` : "account:new";
  const { base, restored } = useDraft(draftKey, {
    group: existing ? groupOf(existing.pay_type) : initialGroup,
    isCash: existing?.pay_type === "cash",
    form: {
    name: text(existing?.name),
    institution: text(existing?.institution),
    description: text(existing?.description),
    opening_balance: existing?.opening_balance ?? "0",
    opening_date: text(existing?.opening_date),
    credit_limit: text(existing?.credit_limit),
    statement_day: existing?.statement_day ? String(existing.statement_day) : "",
    due_day: existing?.due_day ? String(existing.due_day) : "",
    opening_invested: existing?.opening_invested ?? "0",
    current_value: text(existing?.current_value),
    valued_on: text(existing?.valued_on),
    visibility: (existing?.visibility ?? (isOwner ? "shared" : "private")) as "shared" | "private",
    },
  }, !!existing);
  const start = restored ?? (JSON.parse(base) as NonNullable<typeof restored>);
  const [group, setGroup] = useState<AccountGroup>(start.group);
  const [isCash, setIsCash] = useState(start.isCash);
  const [form, setForm] = useState(start.form);
  const [showRestored, setShowRestored] = useState(restored !== null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const modal = useModal();
  const toasts = useToasts();
  const done = modal?.close ?? onDone;
  const set = (changes: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...changes }));
    setErrors((e) => (Object.keys(changes).some((k) => e[k]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in changes))) : e));
  };
  const payType: PayType = group === "bank" && isCash ? "cash" : group;

  useKeepDraft(draftKey, base, { group, isCash, form });

  function clearDraft() {
    const blank = JSON.parse(base) as typeof start;
    setGroup(blank.group);
    setIsCash(blank.isCash);
    setForm(blank.form);
    setErrors({});
    setShowRestored(false);
    formRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }

  useEffect(() => {
    if (attempt) focusFirstInvalid(formRef.current);
  }, [attempt]);

  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (!form.name.trim()) found.name = "Give the account a name.";
    if (!isAmount(form.opening_balance)) found.opening_balance = "Enter a number, like 25000.";
    if (group === "credit_card") {
      if (!isAmount(form.credit_limit)) found.credit_limit = "Enter a number, like 200000.";
      if (!isDay(form.statement_day)) found.statement_day = "Use a day from 1 to 31.";
      if (!isDay(form.due_day)) found.due_day = "Use a day from 1 to 31.";
    }
    if (group === "share_broker") {
      if (!isAmount(form.opening_invested)) found.opening_invested = "Enter a number.";
      if (!isAmount(form.current_value)) found.current_value = "Enter a number.";
    }
    return found;
  }

  function failed(e: Error) {
    const split = splitServerError(e, FIELDS);
    setErrors(split.errors);
    setError(split.general);
    setAttempt((n) => n + 1);
  }

  function refresh() {
    for (const key of ["accounts", "overview", "account-summary"]) client.invalidateQueries({ queryKey: [key] });
  }

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name,
        institution: orNull(form.institution),
        description: orNull(form.description),
        opening_balance: form.opening_balance || "0",
        opening_date: orNull(form.opening_date),
      };
      if (group === "credit_card") {
        body.credit_limit = orNull(form.credit_limit);
        body.statement_day = form.statement_day ? Number(form.statement_day) : null;
        body.due_day = form.due_day ? Number(form.due_day) : null;
      }
      if (group === "share_broker") {
        body.opening_invested = form.opening_invested || "0";
        body.current_value = orNull(form.current_value);
        body.valued_on = form.current_value.trim() ? orNull(form.valued_on) : null;
      }
      if (existing) return patch(`/accounts/${existing.id}`, body);
      return post("/accounts", { ...body, pay_type: payType, visibility: form.visibility });
    },
    onSuccess: () => {
      forgetDraft(draftKey);
      refresh();
      done();
    },
    onError: failed,
  });
  const setActive = useMutation({
    mutationFn: (active: boolean) => patch(`/accounts/${existing!.id}`, { is_active: active }),
    onSuccess: (_data, active) => {
      forgetDraft(draftKey);
      refresh();
      // Deactivating is reversible, so it happens at once and Undo switches it back.
      if (!active)
        toasts.offerUndo({
          text: `Deactivated ${existing!.name}`,
          revert: () => patch(`/accounts/${existing!.id}`, { is_active: true }).then(refresh),
        });
      done();
    },
    onError: (e: Error) => setError(e.message),
  });
  // An account with entries can't be deleted: say so now, not 6 seconds later.
  const remove = useMutation({
    mutationFn: () => api<{ total: number }>(`/transactions?account_id=${existing!.id}&limit=1`),
    onSuccess: ({ total }) => {
      const a = existing!;
      if (total > 0) return setError(`${a.name} has ${total} ${total === 1 ? "entry" : "entries"}, so it can't be deleted. Deactivate it instead.`);
      toasts.deferDelete({ id: a.id, text: `Deleted ${a.name}`, commit: (keepalive) => del(`/accounts/${a.id}`, keepalive), after: refresh });
      forgetDraft(draftKey);
      onDeleted?.();
      done();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    setError("");
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate();
    else setAttempt((n) => n + 1);
  }

  const busy = save.isPending || setActive.isPending || remove.isPending;
  const field = (name: string) => invalidProps(errors, name, formId);
  const err = (name: string) => <FieldError errors={errors} name={name} formId={formId} />;

  return (
    <form ref={formRef} className="tx-form" onSubmit={submit} noValidate aria-busy={busy}>
      {showRestored && <DraftNote onClear={clearDraft} />}
      {existing ? (
        <p className="muted small">
          <span aria-hidden="true">{GROUP_ICON[group]}</span> {existing.pay_type === "cash" ? "Cash" : GROUP_LABEL[group]}. The type
          can't change, because every past entry on this account depends on it.
        </p>
      ) : (
        <>
          <div className="segmented wrap" role="radiogroup" aria-label="Account type">
            {ACCOUNT_GROUPS.map((g) => (
              <button key={g} type="button" role="radio" aria-checked={group === g} className={group === g ? "active" : ""} onClick={() => setGroup(g)}>
                <span aria-hidden="true">{GROUP_ICON[g]}</span> {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
          {group === "bank" && (
            <label className="check">
              <input type="checkbox" checked={isCash} onChange={(e) => setIsCash(e.target.checked)} />
              This is cash (a wallet), not a bank account
            </label>
          )}
        </>
      )}
      <label>
        Account name
        <input required data-autofocus maxLength={60} value={form.name} placeholder={group === "credit_card" ? "e.g. HDFC CC" : "e.g. HDFC"} onChange={(e) => set({ name: e.target.value })} {...field("name")} />
        {err("name")}
      </label>
      {!(group === "bank" && isCash) && (
        <label>
          {INSTITUTION_LABEL[group]} (optional)
          <input maxLength={60} value={form.institution} onChange={(e) => set({ institution: e.target.value })} />
        </label>
      )}
      <div className="form-pair">
        <label>
          {OPENING_LABEL[group]}
          <input inputMode="decimal" value={form.opening_balance} onChange={(e) => set({ opening_balance: e.target.value })} {...field("opening_balance")} />
          {err("opening_balance")}
        </label>
        <label>
          Opening date (optional)
          <input type="date" value={form.opening_date} onChange={(e) => set({ opening_date: e.target.value })} />
        </label>
      </div>
      <p className="hint">With an opening date, only entries on or after it count toward the balance. Without one, every entry counts.</p>
      {group === "credit_card" && (
        <>
          <label>
            Credit limit (₹, optional)
            <input inputMode="decimal" value={form.credit_limit} onChange={(e) => set({ credit_limit: e.target.value })} {...field("credit_limit")} />
            {err("credit_limit")}
          </label>
          <div className="form-pair">
            <label>
              Statement day (1–31)
              <input type="number" min={1} max={31} value={form.statement_day} onChange={(e) => set({ statement_day: e.target.value })} {...field("statement_day")} />
              {err("statement_day")}
            </label>
            <label>
              Payment due day (1–31)
              <input type="number" min={1} max={31} value={form.due_day} onChange={(e) => set({ due_day: e.target.value })} {...field("due_day")} />
              {err("due_day")}
            </label>
          </div>
        </>
      )}
      {group === "share_broker" && (
        <>
          <label>
            Cost of holdings on the opening date (₹)
            <input inputMode="decimal" value={form.opening_invested} onChange={(e) => set({ opening_invested: e.target.value })} {...field("opening_invested")} />
            {err("opening_invested")}
          </label>
          <div className="form-pair">
            <label>
              Current portfolio value (₹, optional)
              <input inputMode="decimal" value={form.current_value} onChange={(e) => set({ current_value: e.target.value })} {...field("current_value")} />
              {err("current_value")}
            </label>
            <label>
              Value as of
              <input type="date" value={form.valued_on} onChange={(e) => set({ valued_on: e.target.value })} />
            </label>
          </div>
          <p className="hint">The app has no live prices. Profit/loss shows only when you enter a value.</p>
        </>
      )}
      <label>
        Description (optional)
        <textarea rows={2} maxLength={500} value={form.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
      {!existing && (
        <label>
          Who can see it
          <select value={form.visibility} onChange={(e) => set({ visibility: e.target.value as "shared" | "private" })}>
            {isOwner && <option value="shared">Shared with household</option>}
            <option value="private">Private (only me)</option>
          </select>
        </label>
      )}
      <p className="muted small">Don't enter account or card numbers, CVVs or PINs. The app doesn't need them.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row wrap">
        <button type="submit" className="primary" disabled={busy}>
          <BusyLabel busy={save.isPending} idle={existing ? "Save changes" : "Add account"} working={existing ? "Saving…" : "Adding…"} />
        </button>
        <button type="button" disabled={busy} onClick={done}>
          Cancel
        </button>
        {existing &&
          (existing.is_active ? (
            <button type="button" disabled={busy} title="Its history stays; it just leaves the pickers and totals." onClick={() => setActive.mutate(false)}>
              Deactivate
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setActive.mutate(true)}>
              Activate
            </button>
          ))}
        {existing && (
          <button type="button" className="danger" disabled={busy} onClick={() => remove.mutate()}>
            <BusyLabel busy={remove.isPending} idle="Delete" working="Deleting…" />
          </button>
        )}
      </div>
    </form>
  );
}
