import { createContext, useContext } from "react";

export interface ModalControls {
  /** Close with the exit transition; a form inside keeps its own draft. */
  close: () => void;
}

export const ModalContext = createContext<ModalControls | null>(null);

/** The surrounding Modal's controls, or null when the form isn't in one. */
export function useModal(): ModalControls | null {
  return useContext(ModalContext);
}
