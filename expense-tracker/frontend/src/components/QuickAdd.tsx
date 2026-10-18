import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { api, post, type Suggestion, type Transaction, type TransactionInput } from "../api";
import { categoryLabel, money, shiftDay, today } from "../format";
import { useAccounts, useCategories, useRefreshMoney } from "../hooks";
import { stillToRepeat } from "../repeat";
import { AccountPicker } from "./AccountPicker";
import { Icon } from "./Icon";

const LAST_ACCOUNT = "et:lastAccount";
const CONFIRM_MS = 4000;

type Message = { text: string; error?: boolean; retry?: boolean; done?: boolean };

function readLastAccount(): string {
  try {
    return localStorage.getItem(LAST_ACCOUNT) ?? "";
  } catch {
    return "";
  }
}

/** My own entries on one day (the button only repeats what I added). */
const myDay = (day: string) => api<{ items: Transaction[] }>(`/transactions?scope=me&limit=500&date_from=${day}&date_to=${day}`).then((page) => page.items);

const entries = (n: number) => `${n} entr${n === 1 ? "y" : "ies"}`;

/** The main way money gets in: amount, description, account, Enter. */
export function QuickAdd() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const categories = useCategories().data ?? [];
  const refresh = useRefreshMoney();
  const amountRef = useRef<HTMLInputElement>(null);
  // isPending only updates on the next render; this catches a second Enter before that.
  const saving = useRef(false);
  const repeating = useRef(false);
  const listId = useId();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(readLastAccount);
  const [date, setDate] = useState(today);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState<Message | null>(null);

  // Fall back to the first account when the remembered one is gone or not loaded yet.
  const account = accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? "");

  // A confirmation fades on its own; errors stay until the next edit.
  useEffect(() => {
    if (!message || message.error) return;
    const id = window.setTimeout(() => setMessage(null), CONFIRM_MS);
    return () => window.clearTimeout(id);
  }, [message]);

  const query = description.trim();
  const suggestions = useQuery({
    queryKey: ["suggest", query],
    queryFn: () => api<Suggestion[]>(`/transactions/suggest?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2 && !picked,
    staleTime: 30_000,
  });

  const now = today();
  const yesterday = useQuery({ queryKey: ["transactions", "day", shiftDay(now, -1)], queryFn: () => myDay(shiftDay(now, -1)), staleTime: 60_000 });
  const todays = useQuery({ queryKey: ["transactions", "day", now], queryFn: () => myDay(now), staleTime: 60_000 });
  // Only what today doesn't have yet, so a double click, reload or retry never adds a copy.
  const toRepeat = yesterday.data && todays.data ? stillToRepeat(yesterday.data, todays.data) : [];

  const save = useMutation({
    mutationFn: (body: TransactionInput) => post<Transaction>("/transactions", body),
    onSuccess: (tx) => {
      const category = categories.find((c) => c.id === tx.category_id);
      setMessage({ text: `Saved ${money(tx.amount, true)} · ${categoryLabel(category)}`, done: true });
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
    onSettled: () => {
      saving.current = false;
    },
  });

  const repeat = useMutation({
    // One at a time, so a failure part-way says exactly which entries didn't go in.
    mutationFn: async (rows: Transaction[]) => {
      const failed: Transaction[] = [];
      for (const t of rows) {
        try {
          await post("/transactions", {
            date: now,
            amount: t.amount,
            type: t.type,
            account_id: t.account_id,
            category_id: t.category_id,
            description: t.description,
            counterparty: t.counterparty,
          });
        } catch {
          failed.push(t);
        }
      }
      return { tried: rows.length, failed };
    },
    onSuccess: ({ tried, failed }) => {
      if (failed.length === 0) setMessage({ text: `Repeated ${entries(tried)} from yesterday`, done: true });
      else {
        const names = failed.map((t) => `${t.description || "(no description)"} ${money(t.amount)}`).join(", ");
        setMessage({ text: `Repeated ${tried - failed.length} of ${tried}. Couldn't add: ${names}`, error: true, retry: true });
      }
    },
    onSettled: () => {
      repeating.current = false;
      refresh();
    },
  });

  function runRepeat() {
    if (repeating.current || toRepeat.length === 0) return;
    repeating.current = true;
    repeat.mutate(toRepeat);
  }

  function edited() {
    if (message) setMessage(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // Enter pressed twice while the first save is in flight must not add it twice.
    if (saving.current || !amount || !account) return;
    saving.current = true;
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
    setOpen(false);
    setActive(-1);
    if (!amount) setAmount(s.amount);
  }

  const options = picked ? [] : (suggestions.data ?? []);
  const showSuggestions = open && options.length > 0;

  function onDescriptionKey(event: KeyboardEvent<HTMLInputElement>) {
    const n = options.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (n === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i === -1 ? (step === 1 ? 0 : n - 1) : (i + step + n) % n));
    } else if (event.key === "Enter" && showSuggestions && active >= 0) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Escape" && showSuggestions) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  if (accountsQuery.isSuccess && accounts.length === 0) {
    return (
      <div className="quick-add" role="status">
        <p className="qa-msg hint">
          Welcome! Add your first account (a bank, card, broker or cash) on the <Link to="/accounts">Accounts</Link>{" "}
          page. Your categories are ready, and you can change them in Settings. Then you can start adding expenses here.
        </p>
      </div>
    );
  }

  const busyRepeating = repeat.isPending || todays.isFetching;

  return (
    <form className="quick-add" onSubmit={submit} onChange={edited} aria-label="Quick add">
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
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls={listId}
          aria-activedescendant={showSuggestions && active >= 0 ? `${listId}-${active}` : undefined}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setPicked(null);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onDescriptionKey}
          onBlur={() => setOpen(false)}
          autoComplete="off"
        />
        <ul className="suggestions" id={listId} role="listbox" aria-label="Suggestions" hidden={!showSuggestions}>
          {options.map((s, i) => (
            <li
              key={s.description}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input so the click doesn't close the list first.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s)}
            >
              <span>{s.description}</span>
              <small>
                {categoryLabel(categories.find((c) => c.id === s.category_id))} · {money(s.amount)}
              </small>
            </li>
          ))}
        </ul>
      </span>
      <AccountPicker accounts={accounts} value={account} onChange={setAccountId} variant="compact" />
      <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
      <button type="submit" className="primary" disabled={save.isPending}>
        {/* Both labels share one grid cell, so the button keeps the wider one's width. */}
        <span className="label-swap">
          <span className={save.isPending ? "off" : undefined}>Add</span>
          <span className={save.isPending ? undefined : "off"} aria-hidden={!save.isPending}>
            Adding…
          </span>
        </span>
      </button>
      {(toRepeat.length > 0 || repeat.isPending) && (
        <button type="button" className="ghost" disabled={busyRepeating} onClick={runRepeat} title="Copy yesterday's entries that aren't in today yet">
          {repeat.isPending ? "Repeating…" : `Repeat yesterday's (${toRepeat.length})`}
        </button>
      )}
      <p className={message?.error ? "qa-msg error" : "qa-msg"} role="status">
        {message?.done && <Icon name="check" />} {message?.text}
        {message?.retry && toRepeat.length > 0 && (
          <>
            {" · "}
            <button type="button" className="ghost small" disabled={busyRepeating} onClick={runRepeat}>
              Retry
            </button>
          </>
        )}
      </p>
      {/debt|credit card bill|card bill/i.test(description) && (
        <p className="qa-msg hint">
          Paying a card bill? Use the full form: a Transfer from the bank to the card, so card spends aren't counted twice.
        </p>
      )}
    </form>
  );
}
