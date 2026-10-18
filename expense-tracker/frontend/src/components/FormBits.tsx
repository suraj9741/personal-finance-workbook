import { useEffect, useId, useRef, useState, type FormEvent } from "react";
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

/**
 * The name with "Rename" beside it. Rename turns the name into a field in the same place:
 * Enter saves, Esc cancels, focus returns to Rename. Clicking away cancels only when nothing
 * was changed, so typing is never lost. A hidden status line says "Renamed to X" after a save.
 */
export function InlineRename({ value, label, onSave, maxLength = 60 }: { value: string; label: string; onSave: (name: string) => Promise<unknown>; maxLength?: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const renameRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasEditing = useRef(false);
  // False when the edit ended by clicking elsewhere: focus stays where the click put it.
  const returnFocus = useRef(true);
  const errorId = useId();

  useEffect(() => {
    if (editing) inputRef.current?.select();
    else if (wasEditing.current && returnFocus.current) renameRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function start() {
    setDraft(value);
    setError("");
    setStatus("");
    setEditing(true);
  }

  function stop(refocus = true) {
    returnFocus.current = refocus;
    setEditing(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (name === value) return stop();
    if (!name) {
      setError("Enter a name.");
      return inputRef.current?.focus();
    }
    setBusy(true);
    try {
      await onSave(name);
      setStatus(`Renamed to ${name}`);
      stop();
    } catch (e) {
      setError((e as Error).message);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-rename">
      {editing ? (
        <form
          onSubmit={save}
          aria-busy={busy}
          onBlur={(e) => {
            if (!busy && !e.currentTarget.contains(e.relatedTarget as Node | null) && draft.trim() === value) stop(false);
          }}
        >
          <input
            ref={inputRef}
            aria-label={label}
            value={draft}
            maxLength={maxLength}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                stop();
              }
            }}
          />
          <button type="submit" className="small primary" disabled={busy}>
            <BusyLabel busy={busy} idle="Save" working="Saving…" />
          </button>
          <button type="button" className="ghost small" disabled={busy} onClick={() => stop()}>
            Cancel
          </button>
          {error && (
            <span id={errorId} className="field-error" role="alert">
              {error}
            </span>
          )}
        </form>
      ) : (
        <>
          <span className="rename-name">{value}</span>
          <button ref={renameRef} type="button" className="ghost small" aria-label={`Rename ${value}`} onClick={start}>
            Rename
          </button>
        </>
      )}
      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
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
