import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useId, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError, del, patch, post, put, type AdminHousehold, type AdminUser, type InviteLink, type Kind, type StatsGroup } from "../api";
import { CopyLink } from "../components/CopyLink";
import { BusyLabel, FieldError, InlineRename } from "../components/FormBits";
import { SegmentedRadio } from "../components/SegmentedRadio";
import { SettingsNav, SettingsSection } from "../components/SettingsNav";
import { useToasts } from "../components/toast-context";
import { invalidProps, splitServerError, type FieldErrors } from "../forms";
import { useMe } from "../hooks";

interface Template {
  id: string;
  kind: Kind;
  parent_name: string;
  sub_name: string;
  stats_group: string;
}

const SECTIONS = [
  { id: "invite", label: "Invite" },
  { id: "users", label: "Users" },
  { id: "households", label: "Households" },
  { id: "template", label: "Category template" },
  { id: "app-settings", label: "App settings" },
];
const KINDS = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
] satisfies { value: Kind; label: string }[];
const GROUPS_FOR: Record<Kind, { value: StatsGroup; label: string }[]> = {
  expense: [
    { value: "spend", label: "Spending" },
    { value: "saving", label: "Saving / investing" },
    { value: "lent", label: "Lent to someone" },
  ],
  income: [
    { value: "earned", label: "Earned income" },
    { value: "repaid", label: "Paid back to me" },
  ],
  transfer: [{ value: "transfer", label: "Transfer" }],
};

const useHouseholds = () => useQuery({ queryKey: ["admin-households"], queryFn: () => api<AdminHousehold[]>("/admin/households") });

export function Admin() {
  const me = useMe().data;
  if (!me?.is_site_admin) return <Navigate to="/" replace />;
  return (
    <div className="admin-page">
      <header className="settings-head">
        <h1>Admin</h1>
      </header>
      <div className="settings-layout">
        <SettingsNav sections={SECTIONS} />
        <div className="settings-content">
          <Invites />
          <Users meId={me.id} />
          <Households />
          <TemplateSection />
          <AppSettings />
        </div>
      </div>
    </div>
  );
}

function useRefresh(...keys: string[]) {
  const client = useQueryClient();
  return () => Promise.all(keys.map((k) => client.invalidateQueries({ queryKey: [k] })));
}

function Invites() {
  const households = useHouseholds().data ?? [];
  const [target, setTarget] = useState("new");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [invite, setInvite] = useState<InviteLink | null>(null);
  const helpId = useId();
  const create = useMutation({
    mutationFn: () =>
      post<InviteLink>("/admin/invites", target === "new" ? { new_household_name: name || null } : { household_id: target, role }),
    onMutate: () => setInvite(null),
    onSuccess: setInvite,
  });
  return (
    <SettingsSection id="invite" title="Invite someone">
      <div className="card">
        <form
          className="settings-form"
          aria-label="Invite someone"
          aria-busy={create.isPending}
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
        >
          <label className="field">
            Invite into
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-describedby={target === "new" ? helpId : undefined}>
              <option value="new">Their own new household (private tracker)</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  Join "{h.name}"
                </option>
              ))}
            </select>
          </label>
          {target === "new" ? (
            <label className="field">
              Household name (optional)
              <input placeholder="e.g. Sam's" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          ) : (
            <label className="field">
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
            </label>
          )}
          <button type="submit" className="primary" disabled={create.isPending}>
            <BusyLabel busy={create.isPending} idle="Create invite link" working="Creating link…" />
          </button>
          {target === "new" && (
            <p id={helpId} className="settings-help form-line">
              They'll be the owner of their new household.
            </p>
          )}
        </form>
        {invite && (
          <CopyLink
            key={invite.id}
            url={invite.url}
            label="Invite link"
            copiedText="Invite link copied"
            note={`For ${invite.household_name ?? "a new household"}. Send it yourself: no email goes out.`}
            expiresAt={invite.expires_at}
          />
        )}
        {create.error && (
          <p className="error" role="alert">
            Couldn't create a link: {create.error.message}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}

type UserChange = { u: AdminUser; is_active?: boolean; is_site_admin?: boolean };

function Users({ meId }: { meId: string }) {
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<AdminUser[]>("/admin/users") }).data ?? [];
  const { offerUndo, notify } = useToasts();
  const refresh = useRefresh("admin-users", "admin-households", "me");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [links, setLinks] = useState<Record<string, string | undefined>>({});
  const setError = (id: string, message?: string) => setErrors((e) => ({ ...e, [id]: message }));

  const update = useMutation({
    mutationFn: ({ u, ...body }: UserChange) => patch(`/admin/users/${u.id}`, body),
    onMutate: ({ u }) => setError(u.id),
    onSuccess: (_, { u, ...body }) => {
      const name = u.display_name;
      const text =
        body.is_active === false ? `Deactivated ${name} and signed them out`
        : body.is_active ? `Activated ${name}`
        : body.is_site_admin ? `${name} is now an admin`
        : `${name} is no longer an admin`;
      const undo = body.is_active !== undefined ? { is_active: !body.is_active } : { is_site_admin: !body.is_site_admin };
      offerUndo({ text, revert: () => patch(`/admin/users/${u.id}`, undo).then(refresh) });
      return refresh();
    },
    onError: (e: Error, { u }) => setError(u.id, e.message),
  });
  const resetLink = useMutation({
    mutationFn: (u: AdminUser) => post<{ url: string }>(`/admin/users/${u.id}/reset-link`),
    onMutate: (u) => setError(u.id),
    onSuccess: (r, u) => setLinks((l) => ({ ...l, [u.id]: r.url })),
    onError: (e: Error, u) => setError(u.id, e.message),
  });
  const revoke = useMutation({
    mutationFn: (u: AdminUser) => post(`/admin/users/${u.id}/revoke-sessions`),
    onMutate: (u) => setError(u.id),
    onSuccess: (_, u) => notify(`Signed ${u.display_name} out everywhere`),
    onError: (e: Error, u) => setError(u.id, e.message),
  });

  return (
    <SettingsSection id="users" title="Users">
      <div className="table-wrap">
        <table className="admin-users">
          <thead>
            <tr>
              <th>Name</th>
              <th>Household</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === meId;
              const resetting = resetLink.isPending && resetLink.variables.id === u.id;
              return (
                <Fragment key={u.id}>
                  <tr className={u.is_active ? undefined : "inactive"}>
                    <td className="admin-user">
                      <InlineRename
                        value={u.display_name}
                        label={`New name for ${u.display_name}`}
                        maxLength={100}
                        onSave={(display_name) => patch(`/admin/users/${u.id}`, { display_name }).then(refresh)}
                      />
                      <span className="admin-user-meta">
                        <span className="muted small">{u.email}</span>
                        {u.is_site_admin && <span className="tag">admin</span>}
                        {isMe && <span className="tag">You</span>}
                      </span>
                    </td>
                    <td data-label="Household">{u.household_name ?? <span className="muted">None</span>}</td>
                    <td data-label="Status">{u.is_active ? <span className="muted">Active</span> : <span className="tag">Deactivated</span>}</td>
                    <td className="actions">
                      <span className="admin-actions">
                        <button type="button" className="ghost small" disabled={resetting} onClick={() => resetLink.mutate(u)}>
                          <BusyLabel busy={resetting} idle="Reset password link" working="Creating link…" />
                        </button>
                        {!isMe && u.is_active && (
                          <button type="button" className="ghost small" disabled={revoke.isPending && revoke.variables.id === u.id} onClick={() => revoke.mutate(u)}>
                            Sign out everywhere
                          </button>
                        )}
                        {!isMe && (
                          <button type="button" className="ghost small" onClick={() => update.mutate({ u, is_site_admin: !u.is_site_admin })}>
                            {u.is_site_admin ? "Remove admin" : "Make admin"}
                          </button>
                        )}
                        {!isMe && (
                          <button
                            type="button"
                            className={u.is_active ? "ghost small danger" : "ghost small"}
                            onClick={() => update.mutate({ u, is_active: !u.is_active })}
                          >
                            {u.is_active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                  {(links[u.id] || errors[u.id]) && (
                    <tr className="admin-link-row">
                      <td colSpan={4}>
                        {errors[u.id] && (
                          <p className="error" role="alert">
                            {errors[u.id]}
                          </p>
                        )}
                        {links[u.id] && (
                          <div className="admin-link">
                            <CopyLink
                              key={links[u.id]}
                              url={links[u.id]!}
                              label={`Password reset link for ${u.display_name}`}
                              copiedText="Reset link copied"
                              note={`Reset link for ${u.display_name}. It works once, for 24 hours. Send it yourself.`}
                            />
                            <button type="button" className="ghost small" onClick={() => setLinks((l) => ({ ...l, [u.id]: undefined }))}>
                              Hide
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  );
}

function Households() {
  const households = useHouseholds().data ?? [];
  const refresh = useRefresh("admin-households", "admin-users", "me");
  return (
    <SettingsSection id="households" title="Households">
      <div className="card">
        <ul className="settings-list">
          {households.map((h) => (
            <li key={h.id} className="household-row">
              <InlineRename value={h.name} label={`New name for ${h.name}`} maxLength={100} onSave={(name) => patch(`/admin/households/${h.id}`, { name }).then(refresh)} />
              <span className="muted small">
                {h.members.length === 0
                  ? "No members yet"
                  : `${h.members.length} ${h.members.length === 1 ? "member" : "members"}: ${h.members.map((m) => `${m.display_name} (${m.role === "owner" ? "Owner" : "Member"})`).join(", ")}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SettingsSection>
  );
}

function TemplateSection() {
  const { hidden, deferDelete, notify } = useToasts();
  const rows = (useQuery({ queryKey: ["admin-template"], queryFn: () => api<Template[]>("/admin/category-template") }).data ?? []).filter((r) => !hidden.has(r.id));
  const refresh = useRefresh("admin-template");
  const [kind, setKind] = useState<Kind>("expense");
  const [parent, setParent] = useState("");
  const [sub, setSub] = useState("");
  const [chosen, setChosen] = useState<{ kind: Kind; group: StatsGroup } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const formId = useId();
  const group = chosen?.kind === kind ? chosen.group : GROUPS_FOR[kind][0].value;
  const add = useMutation({
    mutationFn: () => post<Template>("/admin/category-template", { kind, parent_name: parent, sub_name: sub, stats_group: group }),
    onSuccess: (r) => {
      setSub("");
      notify(`Added ${r.sub_name} to the template`);
      return refresh();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 409) return setErrors({ sub_name: e.message });
      const split = splitServerError(e, ["parent_name", "sub_name"]);
      setErrors(split.errors);
      setError(split.general);
    },
  });
  const remove = (r: Template) =>
    deferDelete({ id: r.id, text: `Removed ${r.sub_name} from the template`, commit: (keepalive) => del(`/admin/category-template/${r.id}`, keepalive), after: refresh });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (add.isPending) return;
    const found: FieldErrors = {};
    if (!parent.trim()) found.parent_name = "Enter a group.";
    if (!sub.trim()) found.sub_name = "Enter a name.";
    setErrors(found);
    setError("");
    if (Object.keys(found).length === 0) add.mutate();
  }

  const shown = rows.filter((r) => r.kind === kind);
  const parents = [...new Set(shown.map((r) => r.parent_name))];
  const field = (name: string) => invalidProps(errors, name, formId);
  return (
    <SettingsSection id="template" title="Category template" intro={`New households get a copy of this list (${rows.length} categories). Existing households are not changed.`}>
      <div className="card">
        <SegmentedRadio label="Category type" options={KINDS} value={kind} onChange={setKind} />
        <form className="settings-form" aria-label="Add to the template" aria-busy={add.isPending} noValidate onSubmit={submit}>
          <label className="field">
            Group
            <input list={`${formId}-parents`} placeholder="e.g. Everyday" maxLength={60} value={parent} onChange={(e) => setParent(e.target.value)} {...field("parent_name")} />
            <FieldError errors={errors} name="parent_name" formId={formId} />
          </label>
          <datalist id={`${formId}-parents`}>
            {parents.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <label className="field">
            Category
            <input placeholder="e.g. Snacks" maxLength={60} value={sub} onChange={(e) => setSub(e.target.value)} {...field("sub_name")} />
            <FieldError errors={errors} name="sub_name" formId={formId} />
          </label>
          {kind !== "transfer" && (
            <label className="field">
              Counts as
              <select value={group} onChange={(e) => setChosen({ kind, group: e.target.value as StatsGroup })}>
                {GROUPS_FOR[kind].map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" disabled={add.isPending}>
            <BusyLabel busy={add.isPending} idle="Add" working="Adding…" />
          </button>
          {error && (
            <p className="error form-line" role="alert">
              {error}
            </p>
          )}
        </form>
        {parents.length === 0 && <p className="muted">Nothing in the template for this type yet.</p>}
        {parents.map((p) => (
          <div key={p} className="template-group">
            <h3>{p}</h3>
            <div className="template-chips">
              {shown
                .filter((r) => r.parent_name === p)
                .map((r) => (
                  <span key={r.id} className="template-chip">
                    {r.sub_name}
                    <button type="button" aria-label={`Remove ${r.sub_name} from the template`} onClick={() => remove(r)}>
                      <span aria-hidden="true">✕</span>
                    </button>
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

/** Known settings get a real label; anything else shows under "Other" by its key. */
const KNOWN_SETTINGS: Record<string, { label: string; help?: string; number?: boolean }> = {
  invite_expiry_days: { label: "Invite links last (days)", number: true },
  currency_symbol: { label: "Currency symbol", help: "Not used yet: amounts always show in ₹." },
};

const DAYS_ERROR = "Use a whole number of days, 1 or more.";

function AppSettings() {
  const client = useQueryClient();
  const data = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<{ values: Record<string, string> }>("/admin/settings") }).data;
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const formId = useId();
  const stored = data?.values ?? {};
  const values = { ...stored, ...edits };
  const changed = Object.keys(edits).filter((k) => edits[k] !== stored[k]);
  const save = useMutation({
    mutationFn: () => put<{ values: Record<string, string> }>("/admin/settings", { values: Object.fromEntries(changed.map((k) => [k, values[k]])) }),
    onSuccess: (r) => {
      client.setQueryData(["admin-settings"], r);
      setEdits({});
      setSaved(true);
    },
    onError: (e: Error) => {
      // The server names the setting at the start of its message ("invite_expiry_days must be…").
      const key = Object.keys(values).find((k) => e.message.startsWith(k));
      setErrors(key ? { [key]: key === "invite_expiry_days" ? DAYS_ERROR : e.message } : { _: e.message });
    },
  });

  function set(key: string, value: string) {
    setEdits((e) => ({ ...e, [key]: value }));
    setErrors((e) => (e[key] || e._ ? {} : e));
    setSaved(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || changed.length === 0) return;
    const days = values.invite_expiry_days;
    if (days !== undefined && !(/^\d+$/.test(days) && Number(days) >= 1)) return setErrors({ invite_expiry_days: DAYS_ERROR });
    setErrors({});
    save.mutate();
  }

  const known = Object.keys(KNOWN_SETTINGS).filter((k) => k in values);
  const other = Object.keys(values).filter((k) => !(k in KNOWN_SETTINGS));
  const input = (key: string) => {
    const meta = KNOWN_SETTINGS[key];
    const helpId = `${formId}-${key}-help`;
    const props = invalidProps(errors, key, formId);
    const describedBy = [meta?.help && helpId, errors[key] && `${formId}-${key}-error`].filter(Boolean).join(" ") || undefined;
    return (
      <label key={key} className="field">
        {meta?.label ?? key}
        <input
          value={values[key]}
          {...(meta?.number ? { type: "number", min: 1, inputMode: "numeric" as const } : { maxLength: 200 })}
          onChange={(e) => set(key, e.target.value)}
          {...props}
          aria-describedby={describedBy}
        />
        {meta?.help && (
          <span id={helpId} className="settings-help" aria-hidden="true">
            {meta.help}
          </span>
        )}
        <FieldError errors={errors} name={key} formId={formId} />
      </label>
    );
  };

  return (
    <SettingsSection id="app-settings" title="App settings">
      <form className="card" aria-label="App settings" aria-busy={save.isPending} noValidate onSubmit={submit}>
        <div className="app-settings-grid">{known.map(input)}</div>
        {other.length > 0 && (
          <>
            <h3>Other</h3>
            <div className="app-settings-grid">{other.map(input)}</div>
          </>
        )}
        <div className="settings-footer">
          <button type="submit" className="primary" disabled={changed.length === 0 || save.isPending}>
            <BusyLabel busy={save.isPending} idle="Save settings" working="Saving…" />
          </button>
          <p className="settings-status" role="status">
            {saved ? "Saved." : ""}
          </p>
        </div>
        {errors._ && (
          <p className="error" role="alert">
            {errors._}
          </p>
        )}
      </form>
    </SettingsSection>
  );
}
