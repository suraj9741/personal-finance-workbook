import { createContext, useContext } from "react";

/** How long Undo stays on offer before the delete is really sent. */
export const UNDO_MS = 6000;

export type Commit = (keepalive: boolean) => Promise<unknown>;

export interface DeferredDelete {
  /** Hidden from lists straight away; the server only hears about it when Undo runs out. */
  id: string;
  text: string;
  commit: Commit;
  /** Runs after the delete succeeds, before the row stops being hidden (usually a refetch). */
  after?: () => unknown;
}

export interface Undoable {
  text: string;
  /** Already done on the server (a deactivation): Undo puts it back. */
  revert: () => Promise<unknown>;
}

export interface Toasts {
  hidden: ReadonlySet<string>;
  deferDelete: (d: DeferredDelete) => void;
  offerUndo: (u: Undoable) => void;
  notify: (text: string, tone?: "error") => void;
  /** Send every delete still waiting (before logging out or leaving). */
  flush: () => Promise<void>;
}

// Outside a provider (tests of a single page), deletes go through at once.
const immediate: Toasts = {
  hidden: new Set(),
  deferDelete: ({ commit, after }) => void commit(false).then(after),
  offerUndo: () => undefined,
  notify: () => undefined,
  flush: () => Promise.resolve(),
};

export const ToastContext = createContext<Toasts>(immediate);

export function useToasts(): Toasts {
  return useContext(ToastContext);
}
