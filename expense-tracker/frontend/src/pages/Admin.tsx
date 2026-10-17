import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, del, patch, post, put, type AdminHousehold, type AdminUser, type InviteLink, type Kind } from "../api";
import { BusyLabel, InlineRename } from "../components/FormBits";
import { useToasts } from "../components/toast-context";
import { useMe } from "../hooks";
import { InviteBox } from "./Settings";

interface Template {
  id: string;
  kind: Kind;
  parent_name: string;
  sub_name: string;
  stats_group: string;
}

export function Admin() {
  const me = useMe().data;
  if (!me?.is_site_admin) return <p>Admins only.</p>;
  return (
    <section className="settings">
      <h1>Admin</h1>
      <Invites />
      <Users meId={me.id} />
      <Households />
      <Template />
      <AppSettings />
    </section>
  );
}

function useRefresh(...keys: string[]) {
  const client = useQueryClient();
  return () => keys.forEach((k) => client.invalidateQueries({ queryKey: [k] }));
}

function Invites() {
  const households = useQuery({ queryKey: ["admin-households"], queryFn: () => api<AdminHousehold[]>("/admin/households") }).data ?? [];
  const [target, setTarget] = useState("new");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [invite, setInvite] = useState<InviteLink | null>(null);
  const [error, setError] = useState("");
  const create = useMutation({
    mutationFn: () =>
      post<InviteLink>("/admin/invites", target === "new" ? { new_household_name: name || null } : { household_id: target, role }),
    onSuccess: setInvite,
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="card">
      <h2>Invite someone</h2>
      <div className="row wrap fields">
        <label className="field">
          Invite into
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
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
            <input placeholder="e.g. Sam's" value={name} onChange={(e) => setName(e.target.value)} />
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
        <button type="button" className="primary" disabled={create.isPending} onClick={() => create.mutate()}>
          <BusyLabel busy={create.isPending} idle="Create invite link" working="Creating…" />
        </button>
      </div>
      {invite && <InviteBox invite={invite} />}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Users({ meId }: { meId: string }) {
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<AdminUser[]>("/admin/users") }).data ?? [];
  const refresh = useRefresh("admin-users", "admin-households");
  const [notice, setNotice] = useState("");
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; is_active?: boolean; is_site_admin?: boolean }) => patch(`/admin/users/${id}`, body),
    onSuccess: refresh,
    onError: (e: Error) => setNotice(e.message),
  });
  const resetLink = useMutation({
    mutationFn: (id: string) => post<{ url: string }>(`/admin/users/${id}/reset-link`),
    onSuccess: (r) => setNotice(`Password reset link (valid 24 hours, send it yourself): ${r.url}`),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => post(`/admin/users/${id}/revoke-sessions`),
    onSuccess: () => setNotice("Signed out everywhere"),
  });
  return (
    <div className="card">
      <h2>Users</h2>
      {notice && <p className="notice break">{notice}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Household</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.display_name} {u.is_site_admin && <small className="tag">admin</small>}
                </td>
                <td>{u.email}</td>
                <td>{u.household_name}</td>
                <td>{u.is_active ? "Active" : "Deactivated"}</td>
                <td className="actions">
                  {u.id !== meId && (
                    <>
                      <button type="button" className="ghost small" onClick={() => update.mutate({ id: u.id, is_active: !u.is_active })}>
                        {u.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button type="button" className="ghost small" onClick={() => update.mutate({ id: u.id, is_site_admin: !u.is_site_admin })}>
                        {u.is_site_admin ? "Remove admin" : "Make admin"}
                      </button>
                    </>
                  )}
                  <button type="button" className="ghost small" onClick={() => resetLink.mutate(u.id)}>
                    Reset link
                  </button>
                  <button type="button" className="ghost small" onClick={() => revoke.mutate(u.id)}>
                    Sign out
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Households() {
  const households = useQuery({ queryKey: ["admin-households"], queryFn: () => api<AdminHousehold[]>("/admin/households") }).data ?? [];
  const refresh = useRefresh("admin-households", "admin-users", "me");
  return (
    <div className="card">
      <h2>Households</h2>
      <ul className="plain">
        {households.map((h) => (
          <li key={h.id} className="row">
            <span>
              <strong>{h.name}</strong>{" "}
              <small className="muted">{h.members.map((m) => `${m.display_name} (${m.role})`).join(", ") || "no members"}</small>
            </span>
            <InlineRename value={h.name} label={`New name for ${h.name}`} onSave={(name) => patch(`/admin/households/${h.id}`, { name }).then(refresh)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Template() {
  const { hidden, deferDelete } = useToasts();
  const rows = (useQuery({ queryKey: ["admin-template"], queryFn: () => api<Template[]>("/admin/category-template") }).data ?? []).filter((r) => !hidden.has(r.id));
  const refresh = useRefresh("admin-template");
  const [kind, setKind] = useState<Kind>("expense");
  const [parent, setParent] = useState("");
  const [sub, setSub] = useState("");
  const [error, setError] = useState("");
  const add = useMutation({
    mutationFn: () => post("/admin/category-template", { kind, parent_name: parent, sub_name: sub }),
    onSuccess: () => {
      setSub("");
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = (r: Template) =>
    deferDelete({ id: r.id, text: `Removed ${r.sub_name} from the template`, commit: (keepalive) => del(`/admin/category-template/${r.id}`, keepalive), after: refresh });
  const shown = rows.filter((r) => r.kind === kind);
  const parents = [...new Set(shown.map((r) => r.parent_name))];
  return (
    <details className="card">
      <summary>
        Category template for new households <small className="muted">({rows.length})</small>
      </summary>
      <p className="muted small">New households get a copy of this list. Existing households are not changed.</p>
      <div className="row wrap fields">
        <label className="field">
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
        <label className="field">
          Group
          <input placeholder="e.g. Everyday" value={parent} onChange={(e) => setParent(e.target.value)} />
        </label>
        <label className="field">
          Category
          <input placeholder="e.g. Snacks" value={sub} onChange={(e) => setSub(e.target.value)} />
        </label>
        <button type="button" disabled={!parent || !sub || add.isPending} onClick={() => add.mutate()}>
          <BusyLabel busy={add.isPending} idle="Add" working="Adding…" />
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {parents.map((p) => (
        <div key={p} className="cat-group">
          <h3>{p}</h3>
          <div className="chips">
            {shown
              .filter((r) => r.parent_name === p)
              .map((r) => (
                <span key={r.id} className="chip">
                  {r.sub_name}
                  <button type="button" aria-label={`Remove ${r.sub_name}`} onClick={() => remove(r)}>
                    ✕
                  </button>
                </span>
              ))}
          </div>
        </div>
      ))}
    </details>
  );
}

function AppSettings() {
  const data = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<{ values: Record<string, string> }>("/admin/settings") }).data;
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const values = { ...(data?.values ?? {}), ...edits };
  const setValues = (key: string, value: string) => setEdits((e) => ({ ...e, [key]: value }));
  const save = useMutation({
    mutationFn: () => put("/admin/settings", { values }),
    onSuccess: () => setMessage("Saved"),
    onError: (e: Error) => setMessage(e.message),
  });
  return (
    <div className="card">
      <h2>App settings</h2>
      {Object.entries(values).map(([key, value]) => (
        <label key={key} className="row">
          <span>{key.replace(/_/g, " ")}</span>
          <input value={value} onChange={(e) => setValues(key, e.target.value)} />
        </label>
      ))}
      <button type="button" onClick={() => save.mutate()}>
        Save settings
      </button>
      {message && <p className="notice">{message}</p>}
    </div>
  );
}
