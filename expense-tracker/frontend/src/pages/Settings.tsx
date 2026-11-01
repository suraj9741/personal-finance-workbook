import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, del, patch, post, put, type Category, type InviteLink, type Kind, type Member, type Rule, type StatsGroup } from "../api";
import { CategoryPicker } from "../components/CategoryPicker";
import { CopyLink } from "../components/CopyLink";
import { BusyLabel, FieldError, InlineRename } from "../components/FormBits";
import { Modal } from "../components/Modal";
import { SegmentedRadio } from "../components/SegmentedRadio";
import { SettingsNav, SettingsSection } from "../components/SettingsNav";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { useToasts } from "../components/toast-context";
import { categoryLabel } from "../format";
import { invalidProps, splitServerError, type FieldErrors } from "../forms";
import { useCategories, useMe, useMembers, useRefreshMoney, useRules } from "../hooks";
import { Icon } from "../components/Icon";

const GROUP_LABEL: Record<StatsGroup, string> = {
  spend: "Spending",
  saving: "Saving / investing",
  lent: "Lent to someone",
  earned: "Earned income",
  repaid: "Paid back to me",
  transfer: "Transfer",
};
/** The "Counts as" choices for each kind; the first is the default. */
const GROUPS_FOR: Record<Kind, StatsGroup[]> = { expense: ["spend", "saving", "lent"], income: ["earned", "repaid"], transfer: ["transfer"] };
const KINDS = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
] satisfies { value: Kind; label: string }[];
const RULE_KINDS = KINDS.filter((k): k is { value: "expense" | "income"; label: string } => k.value !== "transfer");
const KIND_LABEL: Record<Kind, string> = { expense: "Expense", income: "Income", transfer: "Transfer" };
const ROLE_LABEL = { owner: "Owner", member: "Member" } as const;

// Most-changed first; the menu reaches the rest in one tap.
const SECTIONS = [
  { id: "categories", label: "Categories" },
  { id: "rules", label: "Rules" },
  { id: "household", label: "Household" },
  { id: "you", label: "You" },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Settings() {
  const me = useMe().data;
  const isOwner = me?.role === "owner";
  return (
    <div className="settings-page">
      <header className="settings-head">
        <h1>Settings</h1>
        {me?.household_name && (
          <p className="muted">
            {me.household_name} · you're {isOwner ? "an owner" : "a member"}
          </p>
        )}
      </header>
      <div className="settings-layout">
        <SettingsNav sections={SECTIONS} />
        <div className="settings-content">
          <Categories isOwner={isOwner} />
          <Rules isOwner={isOwner} meId={me?.id} />
          <Household isOwner={isOwner} meId={me?.id} />
          <You />
        </div>
      </div>
    </div>
  );
}

function useInvalidate(...keys: string[]) {
  const client = useQueryClient();
  return () => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
}

// ---- categories ----------------------------------------------------------------------

type RowNote = { text: string; blocked?: boolean };

function Categories({ isOwner }: { isOwner: boolean }) {
  const { hidden, deferDelete, offerUndo, notify } = useToasts();
  const categories = (useCategories(true).data ?? []).filter((c) => !hidden.has(c.id));
  const refresh = useInvalidate("categories");
  const [kind, setKind] = useState<Kind>("expense");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, RowNote | undefined>>({});
  const setNote = (id: string, note?: RowNote) => setNotes((n) => ({ ...n, [id]: note }));

  const update = useMutation({
    mutationFn: ({ id, ...changes }: Partial<Category> & { id: string }) => patch(`/categories/${id}`, changes),
    onMutate: ({ id }) => setNote(id),
    onSuccess: refresh,
    onError: (e: Error, { id }) => setNote(id, { text: e.message }),
  });
  // The Family tick covers a whole group, its expense and income categories alike.
  const family = useMutation({
    mutationFn: (body: { parent_name: string; is_family: boolean }) => put<Category[]>("/categories/family", body),
    onSuccess: refresh,
    onError: (e: Error) => notify(e.message, "error"),
  });
  // A category that entries use can't be deleted: say so on its row now, not 6 seconds later.
  const remove = useMutation({
    mutationFn: (c: Category) => api<{ total: number }>(`/transactions?category_id=${c.id}&limit=1`).then(({ total }) => ({ c, total })),
    onMutate: (c) => setNote(c.id),
    onSuccess: ({ c, total }) => {
      if (total > 0) return setNote(c.id, { text: `Used by ${plural(total, "entry", "entries")}, so it can't be deleted.`, blocked: true });
      deferDelete({ id: c.id, text: `Deleted ${c.sub_name}`, commit: (keepalive) => del(`/categories/${c.id}`, keepalive), after: refresh });
    },
    onError: (e: Error, c) => setNote(c.id, { text: e.message }),
  });

  function setActive(c: Category, active: boolean) {
    update.mutate(
      { id: c.id, is_active: active },
      {
        onSuccess: () => {
          if (active) notify(`Activated ${c.sub_name}`);
          else offerUndo({ text: `Deactivated ${c.sub_name}`, revert: () => patch(`/categories/${c.id}`, { is_active: true }).then(refresh) });
        },
      },
    );
  }

  const ofKind = categories.filter((c) => c.kind === kind);
  const inactiveCount = ofKind.filter((c) => !c.is_active).length;
  const q = query.trim().toLowerCase();
  const matches = (c: Category) => !q || c.sub_name.toLowerCase().includes(q) || c.parent_name.toLowerCase().includes(q);
  const listed = (c: Category) => (showInactive || c.is_active) && matches(c);
  const shown = ofKind.filter(listed);
  const parents = [...new Set(shown.map((c) => c.parent_name))];
  const elsewhere = q && shown.length === 0 ? KINDS.filter((k) => k.value !== kind).map((k) => ({ ...k, count: categories.filter((c) => c.kind === k.value && listed(c)).length })).filter((k) => k.count > 0) : [];

  function toggleGroup(parent: string, open: boolean) {
    setOpenGroups((prev) => {
      if (prev.has(parent) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(parent);
      else next.delete(parent);
      return next;
    });
  }

  return (
    <SettingsSection id="categories" title="Categories" intro="Counts as decides where the money shows on the dashboard: Spending, Saving / investing or Lent.">
      <div className="card">
        <div className="cat-toolbar">
          <SegmentedRadio label="Category type" options={KINDS} value={kind} onChange={setKind} />
          <input type="search" aria-label="Find a category" placeholder="Find a category" value={query} onChange={(e) => setQuery(e.target.value)} />
          {(inactiveCount > 0 || showInactive) && (
            <label className="check">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive ({inactiveCount})
            </label>
          )}
          {isOwner ? (
            <AddCategory
              kind={kind}
              parents={[...new Set(ofKind.map((c) => c.parent_name))]}
              onAdded={(parent) => {
                toggleGroup(parent, true);
                return refresh();
              }}
            />
          ) : (
            <p className="muted small">Only owners can change categories.</p>
          )}
        </div>
        <p className="sr-only" role="status">
          {q ? (shown.length ? `${plural(shown.length, "category matches", "categories match")}` : "No categories match") : ""}
        </p>
        {q && shown.length === 0 && (
          <div className="cat-empty">
            <p>No categories match "{query.trim()}".</p>
            {elsewhere.map((k) => (
              <button key={k.value} type="button" className="ghost small" onClick={() => setKind(k.value)}>
                Show {k.count} in {k.label}
              </button>
            ))}
          </div>
        )}
        {parents.map((p) => {
          const rows = shown.filter((c) => c.parent_name === p);
          const open = !!q || openGroups.has(p);
          // A rename covers the same group under the other types too.
          const alsoIn = KINDS.filter((k) => k.value !== kind && categories.some((c) => c.kind === k.value && c.parent_name === p));
          const isFamily = family.isPending && family.variables.parent_name === p ? family.variables.is_family : ofKind.some((c) => c.parent_name === p && c.is_family);
          return (
            <details key={`${kind}:${p}`} className="cat-group" open={open} onToggle={(e) => !q && toggleGroup(p, e.currentTarget.open)}>
              <summary>
                <Icon name="chevron-right" className="disclosure" />
                <h3>
                  {p}
                  {isFamily && <span className="tag">Family</span>}
                </h3>
                <span className="muted small">
                  {rows.length}
                  <span className="sr-only"> {rows.length === 1 ? "category" : "categories"}</span>
                </span>
              </summary>
              {open && (
                <>
                  {isOwner && (
                    <div className="group-rename">
                      <span className="muted small">Group</span>
                      <InlineRename
                        value={p}
                        label={`New name for the ${p} group`}
                        onSave={(name) =>
                          put<Category[]>("/categories/group-name", { parent_name: p, new_name: name }).then(() => {
                            toggleGroup(name, true);
                            return refresh();
                          })
                        }
                      />
                      {alsoIn.length > 0 && <span className="muted small group-rename-note">Renames it under {alsoIn.map((k) => k.label).join(" and ")} too.</span>}
                    </div>
                  )}
                  {kind !== "transfer" && (
                    <label className="check family-tick">
                      <input
                        type="checkbox"
                        checked={isFamily}
                        disabled={!isOwner || family.isPending}
                        onChange={(e) => family.mutate({ parent_name: p, is_family: e.target.checked })}
                      />
                      Family group: show it on the Family cards of the year view
                    </label>
                  )}
                  <div className="cat-row cat-head" aria-hidden="true">
                    <span>Category</span>
                    <span>Counts as</span>
                  </div>
                  <ul className="settings-list">
                    {rows.map((c) => (
                      <CategoryRow
                        key={c.id}
                        c={c}
                        isOwner={isOwner}
                        note={notes[c.id]}
                        group={update.isPending && update.variables.id === c.id && update.variables.stats_group ? update.variables.stats_group : c.stats_group}
                        deleting={remove.isPending && remove.variables.id === c.id}
                        onGroup={(stats_group) => update.mutate({ id: c.id, stats_group })}
                        onRename={(name) => patch(`/categories/${c.id}`, { sub_name: name }).then(refresh)}
                        onActive={(active) => setActive(c, active)}
                        onDelete={() => remove.mutate(c)}
                      />
                    ))}
                  </ul>
                </>
              )}
            </details>
          );
        })}
        {!q && parents.length === 0 && <p className="muted">No {KIND_LABEL[kind].toLowerCase()} categories yet.</p>}
      </div>
    </SettingsSection>
  );
}

function CategoryRow({ c, isOwner, note, group, deleting, onGroup, onRename, onActive, onDelete }: {
  c: Category;
  isOwner: boolean;
  note?: RowNote;
  group: StatsGroup;
  deleting: boolean;
  onGroup: (group: StatsGroup) => void;
  onRename: (name: string) => Promise<unknown>;
  onActive: (active: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <li className="cat-row">
      <div className="cat-name">
        {isOwner ? <InlineRename value={c.sub_name} label={`New name for ${c.sub_name}`} onSave={onRename} /> : <span>{c.sub_name}</span>}
        {!c.is_active && <span className="tag">Inactive</span>}
        {note && (
          <p className={note.blocked ? "cat-note" : "cat-note error"} role="alert">
            <span>{note.text}</span>
            {note.blocked && c.is_active && (
              <button type="button" className="ghost small" onClick={() => onActive(false)}>
                Deactivate instead
              </button>
            )}
          </p>
        )}
      </div>
      <div className="cat-counts">
        {isOwner && c.kind !== "transfer" ? (
          <>
            <span className="cat-caption" aria-hidden="true">
              Counts as
            </span>
            <select aria-label={`${c.sub_name} counts as`} value={group} onChange={(e) => onGroup(e.target.value as StatsGroup)}>
              {GROUPS_FOR[c.kind].map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABEL[g]}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="muted small">{GROUP_LABEL[c.stats_group]}</span>
        )}
      </div>
      {isOwner && (
        <div className="cat-actions">
          <button type="button" className="ghost small" aria-label={`${c.is_active ? "Deactivate" : "Activate"} ${c.sub_name}`} onClick={() => onActive(!c.is_active)}>
            {c.is_active ? "Deactivate" : "Activate"}
          </button>
          <button type="button" className="ghost small danger" aria-label={`Delete ${c.sub_name}`} disabled={deleting} onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function AddCategory({ kind, parents, onAdded }: { kind: Kind; parents: string[]; onAdded: (parent: string) => Promise<unknown> }) {
  const { notify } = useToasts();
  const [parent, setParent] = useState("");
  const [sub, setSub] = useState("");
  const [chosen, setChosen] = useState<{ kind: Kind; group: StatsGroup } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const formId = useId();
  // "Counts as" follows the type switch until it's picked for this type.
  const group = chosen?.kind === kind ? chosen.group : GROUPS_FOR[kind][0];
  const add = useMutation({
    mutationFn: () => post<Category>("/categories", { kind, parent_name: parent, sub_name: sub, stats_group: group }),
    onSuccess: (c) => {
      setSub("");
      notify(`Added ${c.sub_name} to ${c.parent_name}`);
      return onAdded(c.parent_name);
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 409) return setErrors({ sub_name: e.message });
      const split = splitServerError(e, ["parent_name", "sub_name"]);
      setErrors(split.errors);
      setError(split.general);
    },
  });

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

  const field = (name: string) => invalidProps(errors, name, formId);
  return (
    <form className="settings-form" aria-label="Add category" aria-busy={add.isPending} noValidate onSubmit={submit}>
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
              <option key={g} value={g}>
                {GROUP_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" disabled={add.isPending}>
        <BusyLabel busy={add.isPending} idle="Add category" working="Adding…" />
      </button>
      {error && (
        <p className="error form-line" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

// ---- rules ---------------------------------------------------------------------------

function Rules({ isOwner, meId }: { isOwner: boolean; meId?: string }) {
  const { hidden, deferDelete } = useToasts();
  const rules = (useRules().data ?? []).filter((r) => !hidden.has(r.id));
  const categories = useCategories(true).data ?? [];
  const refreshMoney = useRefreshMoney();
  const [applied, setApplied] = useState<number | null>(null);
  const remove = (r: Rule) =>
    deferDelete({ id: r.id, text: `Deleted rule "${r.pattern}"`, commit: (keepalive) => del(`/rules/${r.id}`, keepalive), after: refreshMoney });
  const apply = useMutation({
    mutationFn: () => post<{ updated: number }>("/rules/apply"),
    onMutate: () => setApplied(null),
    onSuccess: (r) => {
      setApplied(r.updated);
      return refreshMoney();
    },
  });

  return (
    <SettingsSection id="rules" title="Rules" intro="When an entry's description contains the text, it gets the category. Rules are checked in order, top first.">
      <div className="card">
        {rules.length > 0 ? (
          <ul className="settings-list">
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} categories={categories} canEdit={isOwner || r.created_by === meId} onDelete={() => remove(r)} onSaved={refreshMoney} />
            ))}
          </ul>
        ) : (
          <p className="muted">No rules yet. Add one below, or use "Save as rule" on an entry.</p>
        )}
        <AddRule categories={categories} onAdded={refreshMoney} />
        <div className="settings-footer">
          <p className="muted small">Run your rules on entries that don't have a category yet.</p>
          <button type="button" disabled={apply.isPending} onClick={() => apply.mutate()}>
            <BusyLabel busy={apply.isPending} idle="Apply to uncategorized" working="Applying…" />
          </button>
        </div>
        <p className="settings-status" role="status">
          {applied !== null && (
            <>
              {applied > 0 ? `Categorized ${plural(applied, "entry", "entries")}.` : "No uncategorized entries matched a rule."}{" "}
              <Link to="/transactions?uncategorized=true">See what's still uncategorized</Link>
            </>
          )}
        </p>
        {apply.error && (
          <p className="error" role="alert">
            Couldn't apply rules: {apply.error.message}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}

function RuleRow({ rule, categories, canEdit, onDelete, onSaved }: { rule: Rule; categories: Category[]; canEdit: boolean; onDelete: () => void; onSaved: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const category = categories.find((c) => c.id === rule.category_id);

  useEffect(() => {
    if (!editing && wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  if (editing) {
    return (
      <li className="rule-row editing">
        <RuleForm
          rule={rule}
          categories={categories}
          onDone={() => setEditing(false)}
          onSaved={onSaved}
        />
      </li>
    );
  }
  return (
    <li className="rule-row">
      <span className="rule-text">
        <strong>"{rule.pattern}"</strong> <Icon name="arrow-right" />
        <span className="sr-only">goes to</span> {categoryLabel(category)}
        {category && !category.is_active && <span className="tag">Inactive</span>}
      </span>
      <span className="rule-order muted small">Order {rule.priority}</span>
      {canEdit && (
        <span className="rule-actions">
          <button ref={editRef} type="button" className="ghost small" aria-label={`Edit rule "${rule.pattern}"`} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="ghost small danger" aria-label={`Delete rule "${rule.pattern}"`} onClick={onDelete}>
            Delete
          </button>
        </span>
      )}
    </li>
  );
}

/** Edit a rule in place: its text, category and order. */
function RuleForm({ rule, categories, onDone, onSaved }: { rule: Rule; categories: Category[]; onDone: () => void; onSaved: () => Promise<unknown> }) {
  const [pattern, setPattern] = useState(rule.pattern);
  const [categoryId, setCategoryId] = useState<string | null>(rule.category_id);
  const [priority, setPriority] = useState(String(rule.priority));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const formId = useId();
  const kind = categories.find((c) => c.id === rule.category_id)?.kind ?? "expense";
  const save = useMutation({
    mutationFn: () => patch(`/rules/${rule.id}`, { pattern: pattern.trim(), category_id: categoryId, priority: Number(priority) }),
    onSuccess: async () => {
      await onSaved();
      onDone();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 409) return setErrors({ pattern: e.message });
      const split = splitServerError(e, ["pattern", "priority"]);
      setErrors(split.errors);
      setError(split.general);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const found: FieldErrors = {};
    if (pattern.trim().length < 2) found.pattern = "Use at least 2 characters.";
    if (!/^\d+$/.test(priority) || Number(priority) > 10000) found.priority = "Use a whole number from 0 to 10000.";
    setErrors(found);
    setError("");
    if (Object.keys(found).length === 0) save.mutate();
  }

  const field = (name: string) => invalidProps(errors, name, formId);
  return (
    <form
      className="settings-form"
      aria-label={`Edit rule "${rule.pattern}"`}
      aria-busy={save.isPending}
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onDone();
        }
      }}
    >
      <label className="field">
        Text to match
        <input autoFocus maxLength={100} value={pattern} onChange={(e) => setPattern(e.target.value)} {...field("pattern")} />
        <FieldError errors={errors} name="pattern" formId={formId} />
      </label>
      <fieldset className="plain-fieldset">
        <legend>Category</legend>
        <CategoryPicker categories={categories.filter((c) => c.is_active || c.id === rule.category_id)} kind={kind} value={categoryId} onChange={setCategoryId} />
      </fieldset>
      <label className="field order-field">
        Order (lower is checked first)
        <input type="number" inputMode="numeric" min={0} max={10000} value={priority} onChange={(e) => setPriority(e.target.value)} {...field("priority")} />
        <FieldError errors={errors} name="priority" formId={formId} />
      </label>
      <span className="form-actions">
        <button type="submit" className="primary" disabled={!categoryId || save.isPending}>
          <BusyLabel busy={save.isPending} idle="Save" working="Saving…" />
        </button>
        <button type="button" className="ghost" disabled={save.isPending} onClick={onDone}>
          Cancel
        </button>
      </span>
      {error && (
        <p className="error form-line" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function AddRule({ categories, onAdded }: { categories: Category[]; onAdded: () => Promise<unknown> }) {
  const { notify } = useToasts();
  const [pattern, setPattern] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const formId = useId();
  const add = useMutation({
    mutationFn: () => post<Rule>("/rules", { pattern: pattern.trim(), category_id: categoryId }),
    onSuccess: (r) => {
      setPattern("");
      notify(`Added rule "${r.pattern}"`);
      return onAdded();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 409) return setErrors({ pattern: e.message });
      const split = splitServerError(e, ["pattern"]);
      setErrors(split.errors);
      setError(split.general);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (add.isPending) return;
    const found: FieldErrors = pattern.trim().length < 2 ? { pattern: "Use at least 2 characters." } : {};
    setErrors(found);
    setError("");
    if (!found.pattern) add.mutate();
  }

  return (
    <form className="settings-form" aria-label="Add rule" aria-busy={add.isPending} noValidate onSubmit={submit}>
      <label className="field">
        Text to match
        <input placeholder="e.g. swiggy" maxLength={100} value={pattern} onChange={(e) => setPattern(e.target.value)} {...invalidProps(errors, "pattern", formId)} />
        <FieldError errors={errors} name="pattern" formId={formId} />
      </label>
      <fieldset className="plain-fieldset">
        <legend>Type</legend>
        <SegmentedRadio
          label="Type"
          options={RULE_KINDS}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setCategoryId(null);
          }}
        />
      </fieldset>
      <fieldset className="plain-fieldset">
        <legend>Category</legend>
        <CategoryPicker categories={categories.filter((c) => c.is_active)} kind={kind} value={categoryId} onChange={setCategoryId} />
      </fieldset>
      <button type="submit" disabled={!categoryId || add.isPending}>
        <BusyLabel busy={add.isPending} idle="Add rule" working="Adding…" />
      </button>
      {error && (
        <p className="error form-line" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

// ---- household -----------------------------------------------------------------------

function Household({ isOwner, meId }: { isOwner: boolean; meId?: string }) {
  const members = useMembers().data ?? [];
  const { offerUndo, notify } = useToasts();
  const refresh = useInvalidate("members");
  const [invite, setInvite] = useState<InviteLink | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [removing, setRemoving] = useState<Member | null>(null);
  const create = useMutation({
    mutationFn: () => post<InviteLink>("/invites", { role: "member" }),
    onSuccess: setInvite,
  });
  const setRole = useMutation({
    mutationFn: ({ m, role }: { m: Member; role: Member["role"] }) => patch(`/household/members/${m.user_id}`, { role }),
    onMutate: ({ m }) => setErrors((e) => ({ ...e, [m.user_id]: undefined })),
    onSuccess: (_, { m, role }) => {
      offerUndo({
        text: `${m.display_name} is now ${role === "owner" ? "an owner" : "a member"}`,
        revert: () => patch(`/household/members/${m.user_id}`, { role: m.role }).then(refresh),
      });
      return refresh();
    },
    onError: (e: Error, { m }) => setErrors((all) => ({ ...all, [m.user_id]: e.message })),
  });
  const remove = useMutation({
    mutationFn: (m: Member) => del(`/household/members/${m.user_id}`),
    onSuccess: (_, m) => {
      setRemoving(null);
      notify(`Removed ${m.display_name}`);
      return refresh();
    },
  });
  const current = members.filter((m) => m.is_active);
  const former = members.filter((m) => !m.is_active);

  return (
    <SettingsSection id="household" title="Household">
      <div className="card">
        <ul className="settings-list">
          {current.map((m) => {
            const role = setRole.isPending && setRole.variables.m.user_id === m.user_id ? setRole.variables.role : m.role;
            const isMe = m.user_id === meId;
            return (
              <li key={m.user_id} className="member-row">
                <span className="member-name">
                  <span>
                    {m.display_name}
                    {isMe && <span className="tag">You</span>}
                  </span>
                  <span className="muted small">{m.email}</span>
                </span>
                {isOwner && !isMe ? (
                  <>
                    <select className="member-role" value={role} aria-label={`${m.display_name}'s role`} onChange={(e) => setRole.mutate({ m, role: e.target.value as Member["role"] })}>
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                    </select>
                    <button
                      type="button"
                      className="ghost small danger member-remove"
                      aria-label={`Remove ${m.display_name}`}
                      onClick={() => {
                        remove.reset();
                        setRemoving(m);
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="member-role muted small">{ROLE_LABEL[m.role]}</span>
                )}
                {errors[m.user_id] && (
                  <p className="row-error error" role="alert">
                    {errors[m.user_id]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {former.length > 0 && (
          <details className="settings-disclosure muted">
            <summary>Former members ({former.length})</summary>
            <ul className="settings-list">
              {former.map((m) => (
                <li key={m.user_id} className="member-row">
                  <span className="member-name">
                    <span>{m.display_name}</span>
                    <span className="small">{m.email}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="settings-footer">
          {isOwner ? (
            <button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
              <BusyLabel busy={create.isPending} idle="Invite a family member" working="Creating link…" />
            </button>
          ) : (
            <p className="muted small">Ask an owner to invite people.</p>
          )}
        </div>
        {invite && (
          <CopyLink key={invite.id} url={invite.url} label="Invite link" copiedText="Invite link copied" note="Send it yourself: no email goes out." expiresAt={invite.expires_at} />
        )}
        {create.error && (
          <p className="error" role="alert">
            Couldn't create a link: {create.error.message}
          </p>
        )}
        <p className="muted small settings-foot-note">Owners can invite and remove people and edit categories.</p>
      </div>
      {removing && (
        // Removing someone signs them out and only a site admin can bring them back, so this one still asks first.
        <Modal title={`Remove ${removing.display_name}?`} onClose={() => setRemoving(null)}>
          <p>They'll be signed out and can't sign in again. Their past entries stay. Only a site admin can bring them back.</p>
          {remove.error && (
            <p className="error" role="alert">
              {remove.error.message}
            </p>
          )}
          <div className="row">
            <button type="button" data-autofocus disabled={remove.isPending} onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button type="button" className="danger filled" disabled={remove.isPending} onClick={() => remove.mutate(removing)}>
              <BusyLabel busy={remove.isPending} idle={`Remove ${removing.display_name}`} working="Removing…" />
            </button>
          </div>
        </Modal>
      )}
    </SettingsSection>
  );
}

// ---- you -----------------------------------------------------------------------------

function You() {
  const me = useMe().data;
  const helpId = useId();
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  const summaryRef = useRef<HTMLElement>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailChanged, setEmailChanged] = useState("");
  const emailSummaryRef = useRef<HTMLElement>(null);
  return (
    <SettingsSection id="you" title="You">
      <div className="card">
        <dl className="settings-list">
          <div className="settings-row">
            <dt>Name</dt>
            <dd>{me?.display_name}</dd>
          </div>
          <div className="settings-row">
            <dt>Email</dt>
            <dd>{me?.email}</dd>
          </div>
          <div className="settings-row">
            <dt>Role</dt>
            <dd>{me?.role ? `${ROLE_LABEL[me.role]} of ${me.household_name}` : "—"}</dd>
          </div>
          <div className="settings-row">
            <dt>Appearance</dt>
            <dd>
              <ThemeSwitch labelled describedBy={helpId} />
              <p id={helpId} className="muted small settings-help">
                System follows your phone or computer.
              </p>
            </dd>
          </div>
        </dl>
        <details
          className="settings-disclosure"
          open={open}
          onToggle={(e) => {
            setOpen(e.currentTarget.open);
            if (e.currentTarget.open) setChanged(false);
          }}
        >
          <summary ref={summaryRef}>Change password…</summary>
          {open && (
            <PasswordForm
              onDone={() => {
                setOpen(false);
                setChanged(true);
                summaryRef.current?.focus();
              }}
            />
          )}
        </details>
        <p className="settings-status" role="status">
          {changed ? "Password changed. Your other devices stay signed in." : ""}
        </p>
        <details
          className="settings-disclosure"
          open={emailOpen}
          onToggle={(e) => {
            setEmailOpen(e.currentTarget.open);
            if (e.currentTarget.open) setEmailChanged("");
          }}
        >
          <summary ref={emailSummaryRef}>Change email…</summary>
          {emailOpen && (
            <EmailForm
              current={me?.email ?? ""}
              onDone={(email) => {
                setEmailOpen(false);
                setEmailChanged(email);
                emailSummaryRef.current?.focus();
              }}
            />
          )}
        </details>
        <p className="settings-status" role="status">
          {emailChanged ? `Email changed. Sign in with ${emailChanged} from now on. You stay signed in here.` : ""}
        </p>
      </div>
    </SettingsSection>
  );
}

const EMAIL_FIELDS = ["new_email", "current_password"];

/** Your own login email: the new one plus your password, so nobody at your open screen can take the login. */
function EmailForm({ current, onDone }: { current: string; onDone: (email: string) => void }) {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const formId = useId();
  const change = useMutation({
    mutationFn: () => post<{ email: string }>("/auth/email", { new_email: email, current_password: password }),
    onSuccess: (me) => {
      client.invalidateQueries({ queryKey: ["me"] });
      client.invalidateQueries({ queryKey: ["members"] });
      onDone(me.email);
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 400) return setErrors({ current_password: e.message });
      if (e instanceof ApiError && e.status === 409) return setErrors({ new_email: e.message });
      const split = splitServerError(e, EMAIL_FIELDS);
      setErrors(split.errors);
      setError(split.general);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (change.isPending) return;
    const found: FieldErrors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) found.new_email = "Enter an email like name@example.com.";
    else if (email.trim().toLowerCase() === current) found.new_email = "That's already your email.";
    if (!password) found.current_password = "Enter your current password.";
    setErrors(found);
    setError("");
    if (Object.keys(found).length === 0) change.mutate();
  }

  const field = (name: string) => invalidProps(errors, name, formId);
  return (
    <form className="settings-form password-form" aria-busy={change.isPending} noValidate onSubmit={submit}>
      <label className="field">
        New email
        <input type="email" autoComplete="email" value={email} placeholder={current} onChange={(e) => setEmail(e.target.value)} {...field("new_email")} />
        <FieldError errors={errors} name="new_email" formId={formId} />
      </label>
      <label className="field">
        Current password
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} {...field("current_password")} />
        <FieldError errors={errors} name="current_password" formId={formId} />
      </label>
      <button type="submit" className="primary" disabled={change.isPending}>
        <BusyLabel busy={change.isPending} idle="Change email" working="Changing…" />
      </button>
      {error && (
        <p className="error form-line" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

const PASSWORD_FIELDS = ["current_password", "new_password"];

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const formId = useId();
  const ruleId = `${formId}-rule`;
  const change = useMutation({
    mutationFn: () => post("/auth/password", { current_password: current, new_password: next }),
    onSuccess: onDone,
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 400) return setErrors({ current_password: e.message });
      const split = splitServerError(e, PASSWORD_FIELDS);
      setErrors(split.errors);
      setError(split.general);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (change.isPending) return;
    const found: FieldErrors = {};
    if (!current) found.current_password = "Enter your current password.";
    if (next.length < 10) found.new_password = "Use at least 10 characters.";
    setErrors(found);
    setError("");
    if (Object.keys(found).length === 0) change.mutate();
  }

  const field = (name: string) => invalidProps(errors, name, formId);
  return (
    <form className="settings-form password-form" aria-busy={change.isPending} noValidate onSubmit={submit}>
      <label className="field">
        Current password
        <input type={show ? "text" : "password"} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} {...field("current_password")} />
        <FieldError errors={errors} name="current_password" formId={formId} />
      </label>
      <label className="field">
        New password
        <input
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          {...field("new_password")}
          aria-describedby={errors.new_password ? `${ruleId} ${formId}-new_password-error` : ruleId}
        />
        <span id={ruleId} className="settings-help" aria-hidden="true">
          At least 10 characters.
        </span>
        <FieldError errors={errors} name="new_password" formId={formId} />
      </label>
      <label className="check">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show passwords
      </label>
      <button type="submit" className="primary" disabled={change.isPending}>
        <BusyLabel busy={change.isPending} idle="Change password" working="Changing…" />
      </button>
      {error && (
        <p className="error form-line" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
