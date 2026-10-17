import { createContext, useContext } from "react";

export interface ModalControls {
  /** A form inside reports whether it has unsaved changes. */
  setDirty: (dirty: boolean) => void;
  /** Close through the guard: asks "Discard your changes?" when there are any. */
  requestClose: () => void;
  /** Close without asking, after a save or a delete. */
  close: () => void;
}

export const ModalContext = createContext<ModalControls | null>(null);

/** The surrounding Modal's controls, or null when the form isn't in one. */
export function useModal(): ModalControls | null {
  return useContext(ModalContext);
}
