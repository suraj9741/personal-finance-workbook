// Keeps every open tab of the app up to date. A tab that saves something tells the others, and
// they refetch what they show, so a Dashboard left open next to Transactions is never stale.

const CHANNEL = "expense-tracker:data-changed";

// Older browsers without BroadcastChannel just keep the old behaviour (refetch on tab switch).
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);

/** Tell the other open tabs that data changed. The tab that sends it doesn't hear it. */
export function announceChange(): void {
  channel?.postMessage("changed");
}

/**
 * Run onChange when another tab changes data. A burst of saves (a repeat, an undo) comes in as
 * one call, `waitMs` after the last one.
 */
export function onOtherTabChange(onChange: () => void, waitMs = 150): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const listener = new BroadcastChannel(CHANNEL);
  let timer: ReturnType<typeof setTimeout> | undefined;
  listener.onmessage = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, waitMs);
  };
  return () => {
    clearTimeout(timer);
    listener.close();
  };
}
