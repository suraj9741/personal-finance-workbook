import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BusyLabel } from "./FormBits";

const COPIED_MS = 2000;

/** "25 Oct", or "25 Oct 2027" outside this year. */
function untilLabel(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/**
 * A link to pass on by hand (invites, password resets): a read-only field, Copy, and Share… where
 * the device has a share sheet. Copy says "Copied" for a moment; if the clipboard refuses, the
 * link is selected so ⌘C / Ctrl+C works, and a hint says so. With `expiresAt`, the note ends
 * "Works once, until 25 Oct."
 */
export function CopyLink({ url, label, copiedText, note, expiresAt }: { url: string; label: string; copiedText: string; note?: ReactNode; expiresAt?: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const hintId = useId();
  const canShare = typeof navigator.share === "function";

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    window.clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error("No clipboard");
      await navigator.clipboard.writeText(url);
      setManual(false);
      setCopied(true);
      timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setCopied(false);
      setManual(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return (
    <div className="copy-link">
      {(note || expiresAt) && (
        <p>
          {note} {expiresAt && `Works once, until ${untilLabel(expiresAt)}.`}
        </p>
      )}
      <div className="copy-link-row">
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label={label}
          aria-describedby={manual ? hintId : undefined}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" onClick={copy}>
          <BusyLabel busy={copied} idle="Copy" working="Copied" />
        </button>
        {canShare && (
          <button type="button" onClick={() => navigator.share({ title: label, url }).catch(() => undefined)}>
            Share…
          </button>
        )}
      </div>
      <p id={hintId} role="status" className={manual ? "settings-status" : "sr-only"}>
        {manual ? "Press ⌘C or Ctrl+C to copy." : copied ? copiedText : ""}
      </p>
    </div>
  );
}
