import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ToastContext, UNDO_MS, type DeferredDelete, type Undoable } from "./toast-context";

const NOTE_MS = 4000;
const MAX_SHOWN = 3;

interface Shown {
  key: number;
  text: string;
  tone?: "error";
  undo?: () => void;
}

interface Timer {
  handle: number;
  remaining: number;
  started: number;
  expire: () => void;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<number, Timer>());
  const pending = useRef(new Map<number, DeferredDelete>());
  const paused = useRef(false);
  const nextKey = useRef(1);

  const setHiddenId = useCallback((id: string, on: boolean) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const dismiss = useCallback((key: number) => {
    const timer = timers.current.get(key);
    if (timer) window.clearTimeout(timer.handle);
    timers.current.delete(key);
    setShown((list) => list.filter((t) => t.key !== key));
  }, []);

  const startTimer = useCallback((key: number, ms: number, expire: () => void) => {
    const timer: Timer = { handle: 0, remaining: ms, started: Date.now(), expire };
    if (!paused.current) timer.handle = window.setTimeout(expire, ms);
    timers.current.set(key, timer);
  }, []);

  const show = useCallback((toast: Omit<Shown, "key">, ms: number, expire?: () => void) => {
    const key = nextKey.current++;
    setShown((list) => [...list, { ...toast, key }]);
    startTimer(key, ms, expire ?? (() => dismiss(key)));
    return key;
  }, [dismiss, startTimer]);

  const notify = useCallback((text: string, tone?: "error") => void show({ text, tone }, NOTE_MS), [show]);

  const commit = useCallback(
    (key: number, keepalive: boolean) => {
      const job = pending.current.get(key);
      if (!job) return Promise.resolve();
      pending.current.delete(key);
      dismiss(key);
      return job
        .commit(keepalive)
        .then(() => job.after?.())
        .catch((e: Error) => notify(`Couldn't delete: ${e.message}`, "error"))
        .finally(() => setHiddenId(job.id, false));
    },
    [dismiss, notify, setHiddenId],
  );

  const deferDelete = useCallback(
    (job: DeferredDelete) => {
      setHiddenId(job.id, true);
      let key = 0;
      const undo = () => {
        if (!pending.current.delete(key)) return;
        dismiss(key);
        setHiddenId(job.id, false);
        notify("Restored");
      };
      key = show({ text: job.text, undo }, UNDO_MS, () => void commit(key, false));
      pending.current.set(key, job);
    },
    [commit, dismiss, notify, setHiddenId, show],
  );

  const offerUndo = useCallback(
    ({ text, revert }: Undoable) => {
      let key = 0;
      const undo = () => {
        dismiss(key);
        revert().then(
          () => notify("Restored"),
          (e: Error) => notify(`Couldn't undo: ${e.message}`, "error"),
        );
      };
      key = show({ text, undo }, UNDO_MS);
    },
    [dismiss, notify, show],
  );

  const flush = useCallback(async () => {
    await Promise.all([...pending.current.keys()].map((key) => commit(key, true)));
  }, [commit]);

  // Leaving or hiding the page sends what's waiting, so a delete is never silently dropped.
  useEffect(() => {
    const onHide = () => void flush();
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      onHide();
    };
  }, [flush]);

  // Cmd/Ctrl+Z undoes the newest toast, unless you're typing in a field (where it undoes text).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.shiftKey || isTyping(event.target)) return;
      const latest = [...shown].reverse().find((t) => t.undo);
      if (!latest) return;
      event.preventDefault();
      latest.undo!();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  // Timers pause while the pointer or focus is on a toast (WCAG 2.2.1), and resume after.
  function pause() {
    if (paused.current) return;
    paused.current = true;
    for (const t of timers.current.values()) {
      window.clearTimeout(t.handle);
      t.remaining = Math.max(0, t.remaining - (Date.now() - t.started));
    }
  }
  function resume() {
    if (!paused.current) return;
    paused.current = false;
    for (const t of timers.current.values()) {
      t.started = Date.now();
      t.handle = window.setTimeout(t.expire, t.remaining);
    }
  }

  const value = useMemo(() => ({ hidden, deferDelete, offerUndo, notify, flush }), [hidden, deferDelete, offerUndo, notify, flush]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="toasts"
        role="status"
        aria-live="polite"
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume();
        }}
      >
        {shown.slice(-MAX_SHOWN).map((t) => (
          <div key={t.key} className={t.tone === "error" ? "toast error" : "toast"}>
            <span>{t.text}</span>
            {t.undo && (
              <button type="button" className="toast-action" onClick={t.undo}>
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
