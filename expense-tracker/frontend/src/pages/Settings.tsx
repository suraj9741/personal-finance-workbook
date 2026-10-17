import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, del, patch, post, type Category, type InviteLink, type Kind, type Member, type StatsGroup } from "../api";
import { CategoryPicker } from "../components/CategoryPicker";
import { BusyLabel, InlineRename } from "../components/FormBits";
import { Modal } from "../components/Modal";
import { useToasts } from "../components/toast-context";
import { categoryLabel } from "../format";
import { useCategories, useMe, useMembers, useRules } from "../hooks";

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
      <Accounts />
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
        className="row wrap fields"
        aria-busy={change.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (!change.isPending) change.mutate();
        }}
      >
        <label className="field">
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          New password (10+ characters)
          <input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <button type="submit" disabled={change.isPending}>
          <BusyLabel busy={change.isPending} idle="Change password" working="Changing…" />
        </button>
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
  const [removing, setRemoving] = useState<Member | null>(null);
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
    onSuccess: () => {
      refresh();
      setRemoving(null);
    },
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
                <button
                  type="button"
                  className="ghost small danger"
                  onClick={() => {
                    remove.reset();
                    setRemoving(m);
                  }}
                >
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
      {removing && (
        // Removing someone logs them out and only a site admin can bring them back, so this one still asks first.
        <Modal title={`Remove ${removing.display_name}?`} onClose={() => setRemoving(null)}>
          <p>They'll be logged out and can't sign in. Their past entries stay. Only a site admin can undo this.</p>
          {remove.error && (
            <p className="error" role="alert">
              {remove.error.message}
            </p>
          )}
          <div className="row">
            <button type="button" data-autofocus disabled={remove.isPending} onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button type="button" className="danger filled" disabled={remove.isPending} onClick={() => remove.mutate(removing.user_id)}>
              <BusyLabel busy={remove.isPending} idle={`Remove ${removing.display_name}`} working="Removing…" />
            </button>
          </div>
        </Modal>
      )}
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

function Accounts() {
  return (
    <div className="card">
      <h2>Accounts</h2>
      <p>
        Bank accounts, credit cards, brokers and cash are managed on the <Link to="/accounts">Accounts</Link> page.
      </p>
    </div>
  );
}

function Rules() {
  const { hidden, deferDelete } = useToasts();
  const rules = (useRules().data ?? []).filter((r) => !hidden.has(r.id));
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
  const remove = (id: string, text: string) =>
    deferDelete({ id, text: `Deleted rule "${text}"`, commit: (keepalive) => del(`/rules/${id}`, keepalive), after: refresh });
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
            <button type="button" className="ghost small" aria-label={`Delete rule "${r.pattern}"`} onClick={() => remove(r.id, r.pattern)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row wrap fields"
        aria-busy={add.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (add.isPending) return;
          setMessage("");
          add.mutate();
        }}
      >
        <label className="field">
          Text to match
          <input placeholder="e.g. swiggy" value={pattern} onChange={(e) => setPattern(e.target.value)} required minLength={2} />
        </label>
        <label className="field">
          Type
          <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setCategoryId(null); }}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <CategoryPicker categories={categories.filter((c) => c.is_active)} kind={kind} value={categoryId} onChange={setCategoryId} />
        <button type="submit" disabled={!categoryId || add.isPending}>
          <BusyLabel busy={add.isPending} idle="Add rule" working="Adding…" />
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
  const { hidden, deferDelete, offerUndo } = useToasts();
  const categories = (useCategories(true).data ?? []).filter((c) => !hidden.has(c.id));
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
  // A category that entries use can't be deleted: say so now, not 6 seconds later.
  const remove = useMutation({
    mutationFn: (c: Category) => api<{ total: number }>(`/transactions?category_id=${c.id}&limit=1`).then(({ total }) => ({ c, total })),
    onSuccess: ({ c, total }) => {
      if (total > 0) return setError(`${c.sub_name} is used by ${total} ${total === 1 ? "entry" : "entries"}, so it can't be deleted. Deactivate it instead.`);
      deferDelete({ id: c.id, text: `Deleted ${c.sub_name}`, commit: (keepalive) => del(`/categories/${c.id}`, keepalive), after: refresh });
    },
    onError: (e: Error) => setError(e.message),
  });
  function toggleActive(c: Category) {
    setError("");
    update.mutate(
      { id: c.id, is_active: !c.is_active },
      {
        onSuccess: () => {
          if (c.is_active) offerUndo({ text: `Deactivated ${c.sub_name}`, revert: () => patch(`/categories/${c.id}`, { is_active: true }).then(refresh) });
        },
      },
    );
  }
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
          className="row wrap fields"
          aria-busy={add.isPending}
          onSubmit={(e) => {
            e.preventDefault();
            if (add.isPending) return;
            setError("");
            add.mutate();
          }}
        >
          <label className="field">
            Group
            <input list="parents" placeholder="e.g. Everyday" value={parent} onChange={(e) => setParent(e.target.value)} required />
          </label>
          <datalist id="parents">
            {parents.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <label className="field">
            Category
            <input placeholder="e.g. Snacks" value={sub} onChange={(e) => setSub(e.target.value)} required />
          </label>
          <button type="submit" disabled={add.isPending}>
            <BusyLabel busy={add.isPending} idle="Add category" working="Adding…" />
          </button>
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
                      <InlineRename
                        value={c.sub_name}
                        label={`New name for ${c.sub_name}`}
                        onSave={(name) => patch(`/categories/${c.id}`, { sub_name: name }).then(refresh)}
                      />
                      <button type="button" className="ghost small" aria-label={`${c.is_active ? "Deactivate" : "Activate"} ${c.sub_name}`} onClick={() => toggleActive(c)}>
                        {c.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        className="ghost small danger"
                        aria-label={`Delete ${c.sub_name}`}
                        disabled={remove.isPending && remove.variables?.id === c.id}
                        onClick={() => {
                          setError("");
                          remove.mutate(c);
                        }}
                      >
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
