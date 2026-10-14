import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { del, patch, post, type Account, type PayType } from "../api";
import { ACCOUNT_GROUPS, GROUP_ICON, GROUP_LABEL, groupOf, type AccountGroup } from "../format";
import { useMe } from "../hooks";

interface Props {
  existing?: Account;
  /** Preselected type for a new account. */
  group?: AccountGroup;
  onDone: () => void;
}

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
export function AccountForm({ existing, group: initialGroup = "bank", onDone }: Props) {
  const me = useMe().data;
  const isOwner = me?.role === "owner";
  const client = useQueryClient();
  const [group, setGroup] = useState<AccountGroup>(existing ? groupOf(existing.pay_type) : initialGroup);
  const [isCash, setIsCash] = useState(existing?.pay_type === "cash");
  const [form, setForm] = useState({
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
    visibility: existing?.visibility ?? (isOwner ? "shared" : "private"),
  });
  const [error, setError] = useState("");
  const set = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));
  const payType: PayType = group === "bank" && isCash ? "cash" : group;

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
      refresh();
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  const setActive = useMutation({
    mutationFn: (active: boolean) => patch(`/accounts/${existing!.id}`, { is_active: active }),
    onSuccess: () => {
      refresh();
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => del(`/accounts/${existing!.id}`),
    onSuccess: () => {
      refresh();
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    save.mutate();
  }

  return (
    <form className="tx-form" onSubmit={submit}>
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
        <input required maxLength={60} value={form.name} placeholder={group === "credit_card" ? "e.g. HDFC CC" : "e.g. HDFC"} onChange={(e) => set({ name: e.target.value })} />
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
          <input inputMode="decimal" value={form.opening_balance} onChange={(e) => set({ opening_balance: e.target.value })} />
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
            <input inputMode="decimal" value={form.credit_limit} onChange={(e) => set({ credit_limit: e.target.value })} />
          </label>
          <div className="form-pair">
            <label>
              Statement day (1–31)
              <input type="number" min={1} max={31} value={form.statement_day} onChange={(e) => set({ statement_day: e.target.value })} />
            </label>
            <label>
              Payment due day (1–31)
              <input type="number" min={1} max={31} value={form.due_day} onChange={(e) => set({ due_day: e.target.value })} />
            </label>
          </div>
        </>
      )}
      {group === "share_broker" && (
        <>
          <label>
            Cost of holdings on the opening date (₹)
            <input inputMode="decimal" value={form.opening_invested} onChange={(e) => set({ opening_invested: e.target.value })} />
          </label>
          <div className="form-pair">
            <label>
              Current portfolio value (₹, optional)
              <input inputMode="decimal" value={form.current_value} onChange={(e) => set({ current_value: e.target.value })} />
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
      {error && <p className="error">{error}</p>}
      <div className="row wrap">
        <button type="submit" className="primary" disabled={save.isPending}>
          {existing ? "Save changes" : "Add account"}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        {existing &&
          (existing.is_active ? (
            <button
              type="button"
              onClick={() => window.confirm(`Deactivate ${existing.name}? Its history stays; it just leaves the pickers and totals.`) && setActive.mutate(false)}
            >
              Deactivate
            </button>
          ) : (
            <button type="button" onClick={() => setActive.mutate(true)}>
              Activate
            </button>
          ))}
        {existing && (
          <button
            type="button"
            className="danger"
            onClick={() => window.confirm(`Delete ${existing.name}? Only possible when it has no entries.`) && remove.mutate()}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
