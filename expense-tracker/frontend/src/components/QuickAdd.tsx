import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, post, type Suggestion, type Transaction, type TransactionInput } from "../api";
import { accountLabel, categoryLabel, money, today } from "../format";
import { useAccounts, useCategories, useRefreshMoney } from "../hooks";

const LAST_ACCOUNT = "et:lastAccount";

function readLastAccount(): string {
  try {
    return localStorage.getItem(LAST_ACCOUNT) ?? "";
  } catch {
    return "";
  }
}

/** The main way money gets in: amount, description, account, Enter. */
export function QuickAdd() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const categories = useCategories().data ?? [];
  const refresh = useRefreshMoney();
  const amountRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(readLastAccount);
  const [date, setDate] = useState(today);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Fall back to the first account when the remembered one is gone or not loaded yet.
  const account = accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? "");

  const query = description.trim();
  const suggestions = useQuery({
    queryKey: ["suggest", query],
    queryFn: () => api<Suggestion[]>(`/transactions/suggest?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2 && !picked,
    staleTime: 30_000,
  });

  const yesterday = useQuery({
    queryKey: ["transactions", "yesterday"],
    queryFn: () => {
      const d = new Date(Date.now() - 86400000);
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      return api<{ items: Transaction[] }>(`/transactions?scope=me&limit=50&month=${iso.slice(0, 7)}`).then((page) =>
        page.items.filter((t) => t.date === iso && t.type !== "transfer"),
      );
    },
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (body: TransactionInput) => post<Transaction>("/transactions", body),
    onSuccess: (tx) => {
      const category = categories.find((c) => c.id === tx.category_id);
      setMessage({ text: `Saved ${money(tx.amount, true)} · ${categoryLabel(category)}` });
      setAmount("");
      setDescription("");
      setPicked(null);
      try {
        localStorage.setItem(LAST_ACCOUNT, tx.account_id);
      } catch {
        /* storage unavailable: fine */
      }
      refresh();
      amountRef.current?.focus();
    },
    onError: (e: Error) => setMessage({ text: e.message, error: true }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!amount || !account) return;
    const body: TransactionInput = {
      date,
      amount,
      type: picked?.type === "income" ? "income" : "expense",
      account_id: account,
      description: description.trim(),
    };
    // A picked suggestion carries its category; otherwise the server's rules decide.
    if (picked && picked.type !== "transfer") body.category_id = picked.category_id;
    save.mutate(body);
  }

  function choose(s: Suggestion) {
    setPicked(s);
    setDescription(s.description);
    setAccountId(s.account_id);
    if (!amount) setAmount(s.amount);
  }

  async function repeatYesterday() {
    const rows = yesterday.data ?? [];
    for (const t of rows) {
      await post("/transactions", {
        date: today(),
        amount: t.amount,
        type: t.type,
        account_id: t.account_id,
        category_id: t.category_id,
        description: t.description,
        counterparty: t.counterparty,
      });
    }
    setMessage({ text: `Repeated ${rows.length} entr${rows.length === 1 ? "y" : "ies"} from yesterday` });
    refresh();
  }

  const showSuggestions = !picked && (suggestions.data?.length ?? 0) > 0;

  if (accountsQuery.isSuccess && accounts.length === 0) {
    return (
      <div className="quick-add" role="status">
        <p className="qa-msg hint">
          Welcome! Add your first account (a bank, card or cash) in <Link to="/settings">Settings</Link>, and
          your own categories there too. Then you can start adding expenses here.
        </p>
      </div>
    );
  }

  return (
    <form className="quick-add" onSubmit={submit} aria-label="Quick add">
      <input
        ref={amountRef}
        className="qa-amount"
        inputMode="decimal"
        placeholder="₹ amount"
        aria-label="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        required
      />
      <span className="qa-desc">
        <input
          placeholder="What was it? (e.g. Swiggy)"
          aria-label="Description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setPicked(null);
          }}
          autoComplete="off"
        />
        {showSuggestions && (
          <ul className="suggestions" role="listbox">
            {suggestions.data!.map((s) => (
              <li key={s.description}>
                <button type="button" onClick={() => choose(s)}>
                  <span>{s.description}</span>
                  <small>
                    {categoryLabel(categories.find((c) => c.id === s.category_id))} · {money(s.amount)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </span>
      <select aria-label="Account" value={account} onChange={(e) => setAccountId(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {accountLabel(a, accounts)}
            {a.visibility === "private" ? " (private)" : ""}
          </option>
        ))}
      </select>
      <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
      <button type="submit" className="primary" disabled={save.isPending}>
        Add
      </button>
      {(yesterday.data?.length ?? 0) > 0 && (
        <button type="button" className="ghost" onClick={repeatYesterday} title="Copy yesterday's entries to today">
          Repeat yesterday's ({yesterday.data!.length})
        </button>
      )}
      {message && (
        <p className={message.error ? "qa-msg error" : "qa-msg"} role="status">
          {message.text}
        </p>
      )}
      {/debt|credit card bill|card bill/i.test(description) && (
        <p className="qa-msg hint">
          Paying a card bill? Use the full form: Transfer › Self Transfer › Bank to Credit, so card spends aren't counted twice.
        </p>
      )}
    </form>
  );
}
