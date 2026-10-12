import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { del, patch, post, type Category, type InviteLink, type Kind, type PayType, type StatsGroup } from "../api";
import { CategoryPicker } from "../components/CategoryPicker";
import { categoryLabel, PAY_TYPE_LABEL } from "../format";
import { useAccounts, useCategories, useMe, useMembers, useRules } from "../hooks";

const GROUP_LABEL: Record<StatsGroup, string> = {
  spend: "Spending",
  saving: "Saving / investing",
  lent: "Lent to someone",
  earned: "Earned income",
  repaid: "Paid back to me",
  transfer: "Transfer",
};

export function Settings() {
  const me = useMe().data;
  const isOwner = me?.role === "owner";
  return (
    <section className="settings">
      <h1>Settings · {me?.household_name}</h1>
      <Profile />
      <Members isOwner={isOwner} />
      <Accounts isOwner={isOwner} />
      <Rules />
      <Categories isOwner={isOwner} />
    </section>
  );
}

function useInvalidate(...keys: string[]) {
  const client = useQueryClient();
  return () => keys.forEach((key) => client.invalidateQueries({ queryKey: [key] }));
}

function Profile() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState("");
  const change = useMutation({
    mutationFn: () => post("/auth/password", { current_password: current, new_password: next }),
    onSuccess: () => {
      setMessage("Password changed");
      setCurrent("");
      setNext("");
    },
    onError: (e: Error) => setMessage(e.message),
  });
  return (
    <details className="card">
      <summary>My password</summary>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <input type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <input type="password" placeholder="New password (10+ characters)" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
        <button type="submit">Change</button>
      </form>
      {message && <p className="notice">{message}</p>}
    </details>
  );
}

function Members({ isOwner }: { isOwner: boolean }) {
  const members = useMembers().data ?? [];
  const me = useMe().data;
  const refresh = useInvalidate("members");
  const [invite, setInvite] = useState<InviteLink | null>(null);
  const [error, setError] = useState("");
  const create = useMutation({
    mutationFn: (role: string) => post<InviteLink>("/invites", { role }),
    onSuccess: setInvite,
    onError: (e: Error) => setError(e.message),
  });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => patch(`/household/members/${id}`, { role }),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/household/members/${id}`),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="card">
      <h2>Members</h2>
      <ul className="plain">
        {members.map((m) => (
          <li key={m.user_id} className="row">
            <span>
              {m.display_name} <small className="muted">{m.email}</small> {!m.is_active && <small className="muted">(deactivated)</small>}
            </span>
            {isOwner && m.user_id !== me?.id && m.is_active ? (
              <>
                <select value={m.role} aria-label={`${m.display_name} role`} onChange={(e) => setRole.mutate({ id: m.user_id, role: e.target.value })}>
                  <option value="owner">Owner</option>
                  <option value="member">Member</option>
                </select>
                <button type="button" className="ghost small danger" onClick={() => window.confirm(`Remove ${m.display_name}? Their past entries stay.`) && remove.mutate(m.user_id)}>
                  Remove
                </button>
              </>
            ) : (
              <small className="muted">{m.role}</small>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <div className="row wrap">
          <button type="button" onClick={() => create.mutate("member")}>
            Invite a family member
          </button>
        </div>
      )}
      {invite && <InviteBox invite={invite} />}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function InviteBox({ invite }: { invite: InviteLink }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="invite-box">
      <p>
        Send this link yourself (no email is sent). It works once and expires {new Date(invite.expires_at).toLocaleDateString("en-IN")}.
      </p>
      <div className="row">
        <input readOnly value={invite.url} aria-label="Invite link" onFocus={(e) => e.target.select()} />
        <button
          type="button"
          onClick={() =>
            navigator.clipboard?.writeText(invite.url).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function Accounts({ isOwner }: { isOwner: boolean }) {
  const accounts = useAccounts(true).data ?? [];
  const me = useMe().data;
  const refresh = useInvalidate("accounts");
  const [name, setName] = useState("");
  const [payType, setPayType] = useState<PayType>("bank");
  const [visibility, setVisibility] = useState<"shared" | "private">(isOwner ? "shared" : "private");
  const [error, setError] = useState("");
  const add = useMutation({
    mutationFn: () => post("/accounts", { name, pay_type: payType, visibility }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => patch(`/accounts/${id}`, { is_active: active }),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="card">
      <h2>Accounts</h2>
      <ul className="plain">
        {accounts.map((a) => {
          const canManage = a.visibility === "private" ? a.owner_user_id === me?.id : isOwner;
          return (
            <li key={a.id} className="row">
              <span className={a.is_active ? "" : "muted"}>
                {a.name} <small className="muted">{PAY_TYPE_LABEL[a.pay_type]}</small>
                {a.visibility === "private" && <small className="tag">private</small>}
              </span>
              {canManage && (
                <button type="button" className="ghost small" onClick={() => toggle.mutate({ id: a.id, active: !a.is_active })}>
                  {a.is_active ? "Deactivate" : "Activate"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="row wrap"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError("");
          add.mutate();
        }}
      >
        <input placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select aria-label="Account type" value={payType} onChange={(e) => setPayType(e.target.value as PayType)}>
          {Object.entries(PAY_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as "shared" | "private")}>
          {isOwner && <option value="shared">Shared with household</option>}
          <option value="private">Private (only me)</option>
        </select>
        <button type="submit">Add account</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Rules() {
  const rules = useRules().data ?? [];
  const categories = useCategories(true).data ?? [];
  const refresh = useInvalidate("rules", "transactions", "stats", "attention");
  const [pattern, setPattern] = useState("");
  const [kind, setKind] = useState<Kind>("expense");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const add = useMutation({
    mutationFn: () => post("/rules", { pattern, category_id: categoryId }),
    onSuccess: () => {
      setPattern("");
      refresh();
    },
    onError: (e: Error) => setMessage(e.message),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/rules/${id}`), onSuccess: refresh });
  const apply = useMutation({
    mutationFn: () => post<{ updated: number }>("/rules/apply"),
    onSuccess: (r) => {
      setMessage(`Categorized ${r.updated} entries`);
      refresh();
    },
  });
  return (
    <div className="card">
      <h2>Auto-categorization rules</h2>
      <p className="muted small">If a description contains the text, the entry gets the category. Lower priority number wins.</p>
      <ul className="plain">
        {rules.map((r) => (
          <li key={r.id} className="row">
            <span>
              "{r.pattern}" → {categoryLabel(categories.find((c) => c.id === r.category_id))} <small className="muted">priority {r.priority}</small>
            </span>
            <button type="button" className="ghost small" onClick={() => remove.mutate(r.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage("");
          add.mutate();
        }}
      >
        <input placeholder="Text to match, e.g. swiggy" value={pattern} onChange={(e) => setPattern(e.target.value)} required minLength={2} />
        <select aria-label="Rule type" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setCategoryId(null); }}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <CategoryPicker categories={categories.filter((c) => c.is_active)} kind={kind} value={categoryId} onChange={setCategoryId} />
        <button type="submit" disabled={!categoryId}>
          Add rule
        </button>
        <button type="button" className="ghost" onClick={() => apply.mutate()}>
          Apply to uncategorized
        </button>
      </form>
      {message && <p className="notice">{message}</p>}
    </div>
  );
}

function Categories({ isOwner }: { isOwner: boolean }) {
  const categories = useCategories(true).data ?? [];
  const refresh = useInvalidate("categories");
  const [kind, setKind] = useState<Kind>("expense");
  const [parent, setParent] = useState("");
  const [sub, setSub] = useState("");
  const [error, setError] = useState("");
  const add = useMutation({
    mutationFn: () => post("/categories", { kind, parent_name: parent, sub_name: sub }),
    onSuccess: () => {
      setSub("");
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, ...changes }: Partial<Category> & { id: string }) => patch(`/categories/${id}`, changes),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/categories/${id}`),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const shown = categories.filter((c) => c.kind === kind);
  const parents = [...new Set(shown.map((c) => c.parent_name))];

  return (
    <details className="card" open={false}>
      <summary>
        Categories <small className="muted">({categories.filter((c) => c.is_active).length} active)</small>
      </summary>
      <div className="segmented" role="radiogroup" aria-label="Category type">
        {(["expense", "income", "transfer"] as Kind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {isOwner && (
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            add.mutate();
          }}
        >
          <input list="parents" placeholder="Group (e.g. Everyday)" value={parent} onChange={(e) => setParent(e.target.value)} required />
          <datalist id="parents">
            {parents.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <input placeholder="Category (e.g. Snacks)" value={sub} onChange={(e) => setSub(e.target.value)} required />
          <button type="submit">Add category</button>
        </form>
      )}
      {parents.map((p) => (
        <div key={p} className="cat-group">
          <h3>{p}</h3>
          <ul className="plain">
            {shown
              .filter((c) => c.parent_name === p)
              .map((c) => (
                <li key={c.id} className="row">
                  <span className={c.is_active ? "" : "muted strike"}>{c.sub_name}</span>
                  {isOwner && c.kind !== "transfer" ? (
                    <select aria-label={`${c.sub_name} counts as`} value={c.stats_group} onChange={(e) => update.mutate({ id: c.id, stats_group: e.target.value as StatsGroup })}>
                      {(c.kind === "expense" ? ["spend", "saving", "lent"] : ["earned", "repaid"]).map((g) => (
                        <option key={g} value={g}>
                          {GROUP_LABEL[g as StatsGroup]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <small className="muted">{GROUP_LABEL[c.stats_group]}</small>
                  )}
                  {isOwner && (
                    <>
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => {
                          const name = window.prompt("Rename category", c.sub_name);
                          if (name && name !== c.sub_name) update.mutate({ id: c.id, sub_name: name });
                        }}
                      >
                        Rename
                      </button>
                      <button type="button" className="ghost small" onClick={() => update.mutate({ id: c.id, is_active: !c.is_active })}>
                        {c.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button type="button" className="ghost small danger" onClick={() => window.confirm(`Delete ${c.sub_name}?`) && remove.mutate(c.id)}>
                        Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </details>
  );
}
