import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ModalContext, type ModalControls } from "./modal-context";

// Where focus goes when the opener is gone (for example, the row that was just deleted).
const FALLBACK_FOCUS = "[data-return-focus]";

function closeAfterTransition(dialog: HTMLDialogElement, done: () => void) {
  const seconds = Math.max(...getComputedStyle(dialog).transitionDuration.split(",").map((t) => parseFloat(t) || 0));
  if (!seconds) return done();
  dialog.dataset.closing = "";
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done();
  };
  dialog.addEventListener("transitionend", finish, { once: true });
  window.setTimeout(finish, seconds * 1000 + 50);
}

/**
 * A native <dialog> opened with showModal(): the page behind is inert, Tab stays inside and
 * Esc asks to close. Focus goes to the field marked data-autofocus, and back to the opener on close.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dirty = useRef(false);
  const closing = useRef(false);
  const pressedOnBackdrop = useRef(false);
  const beforeAsk = useRef<HTMLElement | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    const first =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog.querySelector<HTMLElement>(".modal-body :is(input, select, textarea, button):not([disabled])");
    first?.focus();
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      const target = opener instanceof HTMLElement && opener.isConnected ? opener : document.querySelector<HTMLElement>(FALLBACK_FOCUS);
      target?.focus();
    };
  }, []);

  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    dirty.current = false;
    const dialog = ref.current;
    if (dialog) closeAfterTransition(dialog, () => onCloseRef.current());
    else onCloseRef.current();
  }, []);

  const requestClose = useCallback(() => {
    if (!dirty.current) return close();
    beforeAsk.current = document.activeElement as HTMLElement | null;
    setAsking(true);
  }, [close]);

  function keepEditing() {
    setAsking(false);
    beforeAsk.current?.focus();
  }

  const controls = useMemo<ModalControls>(
    () => ({
      setDirty: (value) => {
        dirty.current = value;
      },
      requestClose,
      close,
    }),
    [requestClose, close],
  );

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: run the same guard as ✕, or step back out of the question.
        event.preventDefault();
        if (asking) keepEditing();
        else requestClose();
      }}
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a click that starts and ends on the backdrop, so a text selection dragged out doesn't close it.
        if (pressedOnBackdrop.current && event.target === event.currentTarget) requestClose();
        pressedOnBackdrop.current = false;
      }}
    >
      <div className="modal-body">
        <span className="sheet-grabber" aria-hidden="true" />
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="ghost" aria-label="Close" onClick={requestClose}>
            ✕
          </button>
        </header>
        <ModalContext.Provider value={controls}>{children}</ModalContext.Provider>
        {asking && (
          <div className="discard-bar" role="alertdialog" aria-labelledby={`${titleId}-discard`}>
            <p id={`${titleId}-discard`}>Discard your changes?</p>
            <div className="row">
              <button ref={keepRef} type="button" onClick={keepEditing}>
                Keep editing
              </button>
              <button type="button" className="danger filled" onClick={close}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
