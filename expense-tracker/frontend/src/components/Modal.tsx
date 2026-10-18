import { useCallback, useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { ModalContext, type ModalControls } from "./modal-context";
import { Icon } from "./Icon";

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
 * A native <dialog> opened with showModal(): the page behind is inert and Tab stays inside.
 * ✕, Esc and a backdrop click close at once; forms keep a draft instead of asking (see draft.ts).
 * Focus goes to the field marked data-autofocus, and back to the opener on close.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closing = useRef(false);
  const pressedOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);

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
    return () => {
      const target = opener instanceof HTMLElement && opener.isConnected ? opener : document.querySelector<HTMLElement>(FALLBACK_FOCUS);
      target?.focus();
    };
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const dialog = ref.current;
    if (dialog) closeAfterTransition(dialog, () => onCloseRef.current());
    else onCloseRef.current();
  }, []);

  const controls = useMemo<ModalControls>(() => ({ close }), [close]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: close with the same transition as ✕.
        event.preventDefault();
        close();
      }}
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a click that starts and ends on the backdrop, so a text selection dragged out doesn't close it.
        if (pressedOnBackdrop.current && event.target === event.currentTarget) close();
        pressedOnBackdrop.current = false;
      }}
    >
      <div className="modal-body">
        <span className="sheet-grabber" aria-hidden="true" />
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="ghost" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <ModalContext.Provider value={controls}>{children}</ModalContext.Provider>
      </div>
    </dialog>
  );
}
