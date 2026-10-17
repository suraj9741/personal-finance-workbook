import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FieldErrors } from "../forms";

export function FieldError({ errors, name, formId }: { errors: FieldErrors; name: string; formId: string }) {
  if (!errors[name]) return null;
  // It usually sits inside the field's <label>: aria-hidden keeps it out of the field's name,
  // and the field's aria-describedby still reads it out.
  return (
    <p id={`${formId}-${name}-error`} className="field-error" aria-hidden="true">
      {errors[name]}
    </p>
  );
}

/** A button label that swaps to "Saving…" without changing the button's width. */
export function BusyLabel({ busy, idle, working }: { busy: boolean; idle: string; working: string }) {
  return (
    <span className="label-swap">
      <span className={busy ? "off" : undefined} aria-hidden={busy}>
        {idle}
      </span>
      <span className={busy ? undefined : "off"} aria-hidden={!busy}>
        {working}
      </span>
    </span>
  );
}

/** "Rename" turns the name into a field in place: Enter saves, Esc cancels, focus returns to Rename. */
export function InlineRename({ value, label, onSave }: { value: string; label: string; onSave: (name: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const renameRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
    else if (wasEditing.current) renameRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function start() {
    setDraft(value);
    setError("");
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name || name === value) return setEditing(false);
    setBusy(true);
    try {
      await onSave(name);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing)
    return (
      <button ref={renameRef} type="button" className="ghost small" aria-label={`Rename ${value}`} onClick={start}>
        Rename
      </button>
    );
  return (
    <form className="inline-rename" onSubmit={save} aria-busy={busy}>
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        maxLength={60}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
      />
      <button type="submit" className="small primary" disabled={busy}>
        <BusyLabel busy={busy} idle="Save" working="Saving…" />
      </button>
      <button type="button" className="ghost small" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </form>
  );
}

/** Shown at the top of a popup form that reopened with what was typed last time. */
export function DraftNote({ onClear }: { onClear: () => void }) {
  return (
    <p className="draft-note" role="status">
      <span>Restored what you typed last time.</span>
      <button type="button" className="ghost small" onClick={onClear}>
        Clear
      </button>
    </p>
  );
}
