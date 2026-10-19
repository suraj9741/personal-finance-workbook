import { Amounts } from "../components/Amounts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, put, type Attention, type Category, type MonthStats } from "../api";
import { BusyLabel } from "../components/FormBits";
import { Meter } from "../components/Meter";
import { MonthPicker } from "../components/MonthPicker";
import { useToasts } from "../components/toast-context";
import { budgetDiff, currentMonth, money, monthLabel, monthShort, paise } from "../format";
import { useCategories, useMe, useRefreshMoney } from "../hooks";
import { Icon } from "../components/Icon";
import { SegmentedRadio } from "../components/SegmentedRadio";

interface BudgetsOut {
  month: string;
  carries_forward: boolean;
  items: { category_id: string; amount: string; this_month_only: boolean; set_in: string }[];
  next_changes: { category_id: string; month: string; amount: string }[];
}

type Kind = "expense" | "income";
/** Unsaved budget edits, per month: month → category id → amount typed. */
type Drafts = Record<string, Record<string, string>>;
type Tone = "bad" | "good" | "muted";

// Per tab, so edits survive switching month or page but not closing the tab (which warns first).
const DRAFTS_KEY = "et:budgetDrafts";
// Per browser: the group cards left open, as "expense:Everyday". Every card starts closed.
const OPEN_KEY = "et:budgetsOpen";

function readOpen(): Set<string> {
  try {
    const keys: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

function readDrafts(): Drafts {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFTS_KEY) ?? "{}") as Drafts;
  } catch {
    return {};
  }
}

/** The drafts with one month's edits replaced; a month left with none is dropped. */
function withMonth(drafts: Drafts, month: string, edits: Record<string, string>): Drafts {
  const next = { ...drafts };
  if (Object.keys(edits).length) next[month] = edits;
  else delete next[month];
  return next;
}

/** An amount as typed: digits with one optional point and up to two decimals, or nothing. */
const isAmount = (v: string) => /^(\d+(\.\d{0,2})?|\.\d{1,2})?$/.test(v);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "October" from "2026-10", for the Apply-to choice. */
const monthName = (month: string) => monthLabel(month).replace(/\s\d{4}$/, "");

/**
 * A budget line in words. Spending: "₹1,800 left" or "₹600 over" (red). Income: "₹2,000 above"
 * (green) or "₹1,000 short". No budget: "—" and no bar. Ratio is actual over budget.
 */
function status(kind: Kind, budget: number, actual: number): { text: string; tone: Tone; ratio: number | null } {
  if (!budget) return { text: "—", tone: "muted", ratio: null };
  const d = budgetDiff(kind, budget, actual);
  const ratio = actual / budget;
  if (kind === "expense") return d < 0 ? { text: `${money(-d)} over`, tone: "bad", ratio } : { text: `${money(d)} left`, tone: "muted", ratio };
  return d < 0 ? { text: `${money(-d)} short`, tone: "muted", ratio } : { text: `${money(d)} above`, tone: d > 0 ? "good" : "muted", ratio };
}

export function Budgets() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? currentMonth();
  const isOwner = useMe().data?.role === "owner";
  const categories = useCategories();
  const allCategories = categories.data;
  const refresh = useRefreshMoney();
  const toasts = useToasts();
  const budgets = useQuery({ queryKey: ["budgets", month], queryFn: () => api<BudgetsOut>(`/budgets?month=${month}`) });
  const stats = useQuery({ queryKey: ["stats", month, "household"], queryFn: () => api<MonthStats>(`/stats/month?month=${month}&scope=household`) });
  const attention = useQuery({ queryKey: ["attention", month], queryFn: () => api<Attention>(`/stats/attention?month=${month}`) });
  // Unsaved edits sit on top of the saved budgets and are kept per month until saved or discarded.
  // Typing the saved amount back removes the edit, so every key left is a real change.
  const [drafts, setDrafts] = useState<Drafts>(readDrafts);
  const [forward, setForward] = useState(true);
  const [open, setOpen] = useState(readOpen);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const lastEdited = useRef<string | null>(null);
  const fieldPrefix = useId();
  const carries = budgets.data?.carries_forward ?? true;
  const onlyThisMonth = !carries || !forward;

  const savedLines = useMemo(() => new Map((budgets.data?.items ?? []).map((i) => [i.category_id, i])), [budgets.data]);
  const pending = useMemo(() => drafts[month] ?? {}, [drafts, month]);
  const saved = (id: string) => Number(savedLines.get(id)?.amount ?? 0);
  // Saved amounts show as typed ("3000", not "3000.00").
  const value = (id: string) => pending[id] ?? savedLines.get(id)?.amount.replace(/\.00$/, "") ?? "";
  const invalid = Object.keys(pending).filter((id) => !isAmount(pending[id]));
  const changed = Object.entries(pending).filter(([id, v]) => isAmount(v) && Number(v || 0) !== saved(id));
  const edits = Object.keys(pending).length;
  const others = Object.entries(drafts)
    .filter(([m, values]) => m !== month && Object.keys(values).length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const hasDrafts = Object.values(drafts).some((values) => Object.keys(values).length > 0);
  const fieldId = (categoryId: string) => `${fieldPrefix}-${categoryId}`;

  const setDraft = (id: string, v: string) => {
    lastEdited.current = id;
    setDrafts((d) => {
      const mine = { ...(d[month] ?? {}) };
      if (isAmount(v) && Number(v || 0) === saved(id)) delete mine[id];
      else mine[id] = v;
      return withMonth(d, month, mine);
    });
  };
  // Esc in a field puts its saved amount back.
  const revert = (id: string) =>
    setDrafts((d) => {
      const mine = { ...(d[month] ?? {}) };
      delete mine[id];
      return withMonth(d, month, mine);
    });

  useEffect(() => {
    try {
      if (hasDrafts) sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      else sessionStorage.removeItem(DRAFTS_KEY);
    } catch {
      /* storage unavailable: drafts last until reload */
    }
  }, [drafts, hasDrafts]);

  // Closing or reloading the tab with unsaved budgets asks first.
  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts]);

  function setGroupOpen(key: string, isOpen: boolean) {
    const next = new Set(open);
    if (isOpen) next.add(key);
    else next.delete(key);
    setOpen(next);
    try {
      if (next.size) localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      else localStorage.removeItem(OPEN_KEY);
    } catch {
      /* storage unavailable: cards stay as left until reload */
    }
  }

  const nextChange = useMemo(() => new Map((budgets.data?.next_changes ?? []).map((n) => [n.category_id, n])), [budgets.data]);
  const actual = useMemo(() => new Map((stats.data?.categories ?? []).map((l) => [l.category_id, Number(l.actual)])), [stats.data]);

  function setMonth(m: string) {
    const next = new URLSearchParams(params);
    next.set("month", m);
    setParams(next, { replace: true });
    setNotice("");
    setError("");
  }

  // The unsaved bar is about to go: put focus back on the field last typed in, not on <body>.
  function focusLastEdited() {
    const field = lastEdited.current ? document.getElementById(fieldId(lastEdited.current)) : null;
    (field ?? document.querySelector<HTMLElement>(".budget-input input"))?.focus();
  }

  const save = useMutation({
    mutationFn: (job: { month: string; only: boolean; items: [string, string][] }) =>
      put(`/budgets`, {
        month: job.month,
        items: job.items.map(([category_id, amount]) => ({ category_id, amount: amount || "0", this_month_only: job.only })),
      }),
    onSuccess: (_data, job) => {
      // A default set earlier for a later month still takes over from that month.
      const stops = job.only
        ? []
        : job.items.flatMap(([id]) => {
            const n = nextChange.get(id);
            const c = allCategories?.find((x) => x.id === id);
            return n && c ? [`${c.sub_name} keeps ${money(n.amount)} from ${monthLabel(n.month)}, which you set before.`] : [];
          });
      toasts.notify(job.only ? `Budgets saved for ${monthLabel(job.month)} only.` : `Budgets saved for ${monthLabel(job.month)} and later.`);
      setNotice(stops.join(" "));
      focusLastEdited();
      setDrafts((d) => withMonth(d, job.month, {}));
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!isOwner || save.isPending || invalid.length > 0 || changed.length === 0) return;
    setError("");
    save.mutate({ month, only: onlyThisMonth, items: changed });
  }

  function discard() {
    const snapshot = pending;
    const m = month;
    focusLastEdited();
    setDrafts((d) => withMonth(d, m, {}));
    setError("");
    // Edits typed after the discard win over the ones Undo brings back.
    toasts.offerUndo({
      text: `Discarded ${plural(Object.keys(snapshot).length, "change", "changes")}`,
      revert: async () => setDrafts((d) => withMonth(d, m, { ...snapshot, ...(d[m] ?? {}) })),
    });
  }

  const note = (id: string) => {
    const line = savedLines.get(id);
    const edited = pending[id] !== undefined;
    if (line?.this_month_only && !edited) return "Only this month";
    const parts = [];
    if (line && !edited && line.set_in !== month) parts.push(`Set in ${monthShort(line.set_in)}`);
    const next = nextChange.get(id);
    if (next && carries && !(edited && onlyThisMonth)) parts.push(`${money(next.amount)} from ${monthShort(next.month)}`);
    return parts.length ? parts.join(" · ") : null;
  };

  const failed = categories.isError || budgets.isError || stats.isError;
  const ready = allCategories && budgets.data && stats.data;
  const uncategorized = attention.data?.uncategorized ?? 0;

  return (
    <form className="budget-page" onSubmit={submit} noValidate aria-label="Budgets">
      <div className="toolbar">
        <h1>Budgets</h1>
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      <p className="muted small budget-intro">
        {isOwner ? "A budget carries on to later months until you change it." : "Only the household owner can change budgets."}
      </p>
      {notice && (
        <p className="notice" role="status">
          {notice}{" "}
          <button type="button" className="ghost small" aria-label="Dismiss" onClick={() => setNotice("")}>
            <Icon name="close" />
          </button>
        </p>
      )}
      {uncategorized > 0 && (
        <p className="notice">
          {uncategorized === 1 ? "1 entry this month has no category, so it isn't counted here." : `${uncategorized} entries this month have no category, so they aren't counted here.`}{" "}
          <Link to={`/transactions?month=${month}&uncategorized=true`}>
            <strong>Categorize them</strong>
          </Link>
        </p>
      )}
      {failed ? (
        <div className="card budget-state">
          <p>Couldn't load budgets.</p>
          <button
            type="button"
            onClick={() => {
              void categories.refetch();
              void budgets.refetch();
              void stats.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : !ready ? (
        <div className="budget-grid" aria-busy="true" aria-label="Loading budgets">
          {[0, 1].map((i) => (
            <div className="card budget-skeleton" key={i} aria-hidden="true">
              {[0, 1, 2, 3].map((j) => (
                <span className="skeleton" key={j} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        (["expense", "income"] as const).map((kind) => (
          <BudgetSection
            key={kind}
            kind={kind}
            month={month}
            categories={allCategories.filter((c) => c.kind === kind && c.is_active)}
            value={value}
            actual={actual}
            note={note}
            fieldId={fieldId}
            pending={pending}
            isOpen={(parent) => open.has(`${kind}:${parent}`)}
            onToggle={(parent, isOpen) => setGroupOpen(`${kind}:${parent}`, isOpen)}
            onChange={isOwner ? setDraft : undefined}
            onRevert={revert}
          />
        ))
      )}
      {isOwner && (edits > 0 || others.length > 0) && (
        <div className="unsaved-bar" role="region" aria-label="Unsaved budgets">
          <div className="unsaved-text">
            <span>{edits > 0 ? `${plural(edits, "change", "changes")} for ${monthLabel(month)}` : `No changes for ${monthLabel(month)}`}</span>
            {invalid.length > 0 && <span className="field-error">Fix {plural(invalid.length, "amount", "amounts")} to save</span>}
            {others.length > 0 && (
              <span className="unsaved-others">
                Also unsaved:
                {others.map(([m, values]) => (
                  <button key={m} type="button" className="ghost small" onClick={() => setMonth(m)}>
                    {monthLabel(m)} ({Object.keys(values).length})
                  </button>
                ))}
              </span>
            )}
          </div>
          {edits > 0 &&
            (carries ? (
              <div className="unsaved-apply">
                <span aria-hidden="true">Apply to:</span>
                <SegmentedRadio
                  label="Apply to"
                  value={forward ? "later" : "only"}
                  onChange={(v) => setForward(v === "later")}
                  options={[
                    { value: "later", label: `${monthName(month)} and later` },
                    { value: "only", label: `${monthName(month)} only` },
                  ]}
                />
              </div>
            ) : (
              <span className="muted small">Past month: saves for {monthLabel(month)} only</span>
            ))}
          {edits > 0 && (
            <div className="unsaved-actions">
              <button type="button" className="ghost" disabled={save.isPending} onClick={discard}>
                Discard
              </button>
              <button type="submit" className="primary" disabled={save.isPending || invalid.length > 0 || changed.length === 0}>
                <BusyLabel busy={save.isPending} idle="Save budgets" working="Saving…" />
              </button>
            </div>
          )}
          {error && (
            <p className="field-error unsaved-error" role="alert">
              Couldn't save: {error}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

function BudgetSection({
  kind,
  month,
  categories,
  value,
  actual,
  note,
  fieldId,
  pending,
  isOpen,
  onToggle,
  onChange,
  onRevert,
}: {
  kind: Kind;
  month: string;
  categories: Category[];
  value: (id: string) => string;
  actual: Map<string, number>;
  note: (id: string) => string | null;
  fieldId: (id: string) => string;
  pending: Record<string, string>;
  isOpen: (parent: string) => boolean;
  onToggle: (parent: string, open: boolean) => void;
  onChange?: (id: string, v: string) => void;
  onRevert: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) map.set(c.parent_name, [...(map.get(c.parent_name) ?? []), c]);
    return [...map.entries()];
  }, [categories]);
  const headingId = useId();
  const sum = (list: Category[], f: (c: Category) => number) => paise(list.reduce((t, c) => t + f(c), 0));
  // An amount still being fixed counts as nothing until it's a number.
  const budgetOf = (c: Category) => Number(value(c.id)) || 0;
  const actualOf = (c: Category) => actual.get(c.id) ?? 0;
  const spentLabel = kind === "expense" ? "Spent" : "Earned";
  const title = kind === "expense" ? "Spending" : "Income";

  return (
    <section className="budget-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {categories.length === 0 ? (
        <div className="card">
          <p className="muted">
            No {kind === "expense" ? "spending" : "income"} categories yet. <Link to="/settings">Add them in Settings</Link>
          </p>
        </div>
      ) : (
        <>
          <BudgetSummary kind={kind} budget={sum(categories, budgetOf)} actual={sum(categories, actualOf)} />
          <div className="budget-grid">
            {grouped.map(([parent, subs]) => {
              const total = sum(subs, actualOf);
              const group = status(kind, sum(subs, budgetOf), total);
              const opened = isOpen(parent);
              // Closed, a card still shows how the group stands, and a dot if a line in it is edited.
              return (
                <details
                  className="card budget-group"
                  key={parent}
                  open={opened}
                  onToggle={(e) => {
                    if (e.currentTarget.open !== opened) onToggle(parent, e.currentTarget.open);
                  }}
                >
                  <summary className="budget-card-head" data-dirty={subs.some((c) => pending[c.id] !== undefined) || undefined}>
                    <Icon name="chevron-right" className="disclosure" />
                    <h3>{parent}</h3>
                    <span className={`budget-status ${group.tone}`}>
                      <Amounts>{group.ratio === null ? `${money(total)} ${spentLabel.toLowerCase()}` : group.text}</Amounts>
                    </span>
                    {group.ratio !== null && (
                      <span className="budget-group-meter">
                        <Meter ratio={group.ratio} tone={kind === "income" ? "income" : undefined} />
                      </span>
                    )}
                  </summary>
                  <div className="budget-line budget-head" aria-hidden="true">
                    <span />
                    <span>Budget</span>
                    <span>{spentLabel}</span>
                    <span>{kind === "expense" ? "Left" : "vs plan"}</span>
                  </div>
                  {subs.map((c) => {
                    const id = fieldId(c.id);
                    const spent = actualOf(c);
                    const budget = budgetOf(c);
                    const s = status(kind, budget, spent);
                    const hint = note(c.id);
                    const raw = value(c.id);
                    const dirty = pending[c.id] !== undefined;
                    const bad = !isAmount(raw);
                    const caption = `${money(spent)} ${spentLabel.toLowerCase()}${s.ratio === null ? "" : ` · ${s.text}`}`;
                    return (
                      <div key={c.id} className="budget-line" data-dirty={dirty || undefined}>
                        <span className="budget-name">
                          <Link to={`/transactions?month=${month}&category_id=${c.id}`}>{c.sub_name}</Link>
                          {hint && (
                            <small id={`${id}-note`} className="muted budget-note">
                              {hint}
                            </small>
                          )}
                        </span>
                        {onChange ? (
                          <span className="budget-input">
                            <span aria-hidden="true">₹</span>
                            <input
                              id={id}
                              inputMode="decimal"
                              autoComplete="off"
                              placeholder="—"
                              value={raw}
                              onChange={(e) => onChange(c.id, e.target.value.replace(/[,\s₹]/g, ""))}
                              onKeyDown={(e) => {
                                if (e.key === "Escape" && dirty) {
                                  e.preventDefault();
                                  onRevert(c.id);
                                }
                              }}
                              aria-label={`${parent} ${c.sub_name} budget`}
                              aria-invalid={bad || undefined}
                              aria-describedby={[bad && `${id}-error`, hint && `${id}-note`, `${id}-spent`, `${id}-status`].filter(Boolean).join(" ")}
                            />
                          </span>
                        ) : (
                          <span className="num budget-amount">
                            <span className="sr-only">Budget </span>
                            <Amounts>{budget ? money(budget) : "—"}</Amounts>
                          </span>
                        )}
                        <span id={`${id}-spent`} className="num budget-spent">
                          <span className="sr-only">{spentLabel} </span>
                          <Amounts>{money(spent)}</Amounts>
                        </span>
                        <span id={`${id}-status`} className={`num budget-status ${s.tone}`}>
                          {s.ratio === null ? (
                            <>
                              <span aria-hidden="true">—</span>
                              <span className="sr-only">No budget</span>
                            </>
                          ) : (
                            <Amounts>{s.text}</Amounts>
                          )}
                        </span>
                        {s.ratio === null ? (
                          <small className="budget-meter muted">No budget</small>
                        ) : (
                          <span className="budget-meter">
                            <Meter ratio={s.ratio} tone={kind === "income" ? "income" : undefined} />
                          </span>
                        )}
                        <small className="budget-caption muted">
                          <Amounts>{caption}</Amounts>
                        </small>
                        {bad && (
                          <p id={`${id}-error`} className="field-error budget-error">
                            Enter a number, like 5000.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/** "₹18,200 left of ₹40,000" (or "₹2,300 over ₹40,000"), the share spent, and one large bar. */
function BudgetSummary({ kind, budget, actual }: { kind: Kind; budget: number; actual: number }) {
  const s = status(kind, budget, actual);
  if (s.ratio === null)
    return (
      <div className="budget-summary">
        <p className="budget-summary-figure">
          {kind === "expense" ? "Spent" : "Earned"} <Amounts>{money(actual)}</Amounts>
        </p>
        <p className="muted small">No budget set for this month yet.</p>
      </div>
    );
  const d = budgetDiff(kind, budget, actual);
  const share = `${Math.round(s.ratio * 100)}%`;
  return (
    <div className="budget-summary">
      <p className={`budget-summary-figure ${s.tone === "bad" ? "bad" : ""}`}>
        <Amounts>
          {kind === "income"
            ? `Earned ${money(actual)} of ${money(budget)} planned`
            : d < 0
              ? `${money(-d)} over ${money(budget)}`
              : `${money(d)} left of ${money(budget)}`}
        </Amounts>
      </p>
      <p className="muted small">
        <Amounts>{kind === "income" ? `${s.text} · ${share}` : `Spent ${money(actual)} · ${share}`}</Amounts>
      </p>
      <Meter ratio={s.ratio} tone={kind === "income" ? "income" : undefined} size="lg" />
    </div>
  );
}
