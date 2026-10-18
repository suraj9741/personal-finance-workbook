import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Icon, type IconName } from "./Icon";

export interface PickerItem {
  id: string;
  label: string;
  /** Heading the item is listed under; searching matches it too ("gotu" finds every Gotu category). */
  group: string;
  icon?: IconName;
  /** A picture to show instead of the icon, e.g. the account's bank logo. */
  logo?: string;
  /** Small grey text at the end of the row, e.g. "card" or "private". */
  hint?: string;
}

interface Props {
  items: PickerItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** What is being picked, e.g. "Account". Names the button and the list. */
  label: string;
  /** An extra first choice that means "none", e.g. "Uncategorized". */
  none?: string;
  /** The button shows "Group › Item" (categories) instead of just the item. */
  showGroup?: boolean;
  /** Shown in the block at the button's left when the choice has no icon of its own. */
  icon?: IconName;
  id?: string;
  className?: string;
}

// The list never gets narrower than this, so short buttons (a table cell) still fit long names.
const MIN_WIDTH_REM = 17;
const GAP_PX = 6;
// Below this much room under the button, the list opens upwards if there is more room above.
const ROOM_PX = 280;
// How long the closing list stays on screen to fade out (a little over --motion-fast).
const LEAVE_MS = 220;

interface Placement {
  x: number;
  y: number;
  width: number;
  maxHeight: number;
  up: boolean;
}

function place(button: HTMLElement): Placement {
  const r = button.getBoundingClientRect();
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const width = Math.min(Math.max(r.width, MIN_WIDTH_REM * rem), window.innerWidth - 2 * rem);
  const below = window.innerHeight - r.bottom - GAP_PX;
  const above = r.top - GAP_PX;
  const up = below < ROOM_PX && above > below;
  return {
    x: Math.max(rem, Math.min(r.left, window.innerWidth - width - rem)),
    y: up ? r.top - GAP_PX : r.bottom + GAP_PX,
    width,
    maxHeight: Math.max((up ? above : below) - rem, ROOM_PX / 2),
    up,
  };
}

const matches = (item: PickerItem, query: string) =>
  !query || item.label.toLowerCase().includes(query) || item.group.toLowerCase().includes(query);

/** The typed text in bold, so it is clear why a row matched. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * A dropdown you can type into: the button shows the choice (with its icon in a block at the left),
 * and opening it turns the button's text into a search box over a list of items under group
 * headings. Arrow keys, Enter and Esc work as in a native menu. The list slides open and fades
 * away when it closes. It is position: fixed, so a table's scroll box or a dialog doesn't clip it.
 */
export function SearchPicker({ items, value, onChange, label, none, showGroup = false, icon, id, className }: Props) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const buttonId = id ?? `${uid}-button`;
  const listId = `${uid}-list`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // While true the list is still on screen, fading out, but no longer usable.
  const [leaving, setLeaving] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Touch screens skip focusing the search box, so the keyboard doesn't cover the list.
  const [focusSearch, setFocusSearch] = useState(true);
  const open = placement !== null && !leaving;

  const selected = items.find((i) => i.id === value);
  const q = query.trim().toLowerCase();
  const noneShown = none !== undefined && (!q || none.toLowerCase().includes(q));
  const shown = items.filter((i) => matches(i, q));
  // One list of choices in screen order: the "none" row (id null) first, then the items.
  const choices: (PickerItem | null)[] = [...(noneShown ? [null] : []), ...shown];
  const grouped = new Set(items.map((i) => i.group)).size > 1;
  // A heading goes above the first shown item of each group.
  const headed = choices.map((item, index) => !!item && grouped && item.group !== choices[index - 1]?.group);

  function openList() {
    const button = buttonRef.current;
    if (!button) return;
    setQuery("");
    setActive(Math.max(0, (none !== undefined ? [null, ...items] : items).findIndex((c) => (c?.id ?? null) === (selected?.id ?? null))));
    setFocusSearch(window.matchMedia?.("(pointer: fine)").matches ?? true);
    setLeaving(false);
    setPlacement(place(button));
  }

  function close(returnFocus: boolean) {
    setLeaving(true);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(index: number) {
    const choice = choices[index];
    if (choice !== undefined) onChange(choice?.id ?? null);
    close(true);
  }

  // While open: a press outside, a resize, or scrolling the page closes the list (as a native menu does).
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setLeaving(true);
    };
    const scrolled = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setLeaving(true);
    };
    const resized = () => setLeaving(true);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
    };
  }, [open]);

  // Once the fade-out has played, take the list away.
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => {
      setPlacement(null);
      setLeaving(false);
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  useEffect(() => {
    listRef.current?.querySelector("[data-active]")?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => Math.min(Math.max(a + step, 0), choices.length - 1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : choices.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      // Without this the Esc would also close a dialog the picker sits in.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  const buttonText = selected ? (showGroup ? `${selected.group} › ${selected.label}` : selected.label) : (none ?? "Choose…");
  const style = placement
    ? ({
        "--pop-x": `${placement.x}px`,
        "--pop-y": `${placement.y}px`,
        "--pop-w": `${placement.width}px`,
        "--pop-max-h": `${placement.maxHeight}px`,
      } as CSSProperties)
    : undefined;

  const leadLogo = selected?.logo;
  const leadIcon = selected?.icon ?? icon;
  const hasLead = !!(leadLogo || leadIcon);

  return (
    <span className={["search-picker", hasLead ? "has-lead" : "", open ? "open" : "", className ?? ""].filter(Boolean).join(" ")} ref={rootRef}>
      <span id={labelId} hidden>
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        id={buttonId}
        className="search-picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${buttonId}`}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openList();
          }
        }}
      >
        {hasLead && (
          <span className="search-picker-lead">
            {leadLogo ? (
              <span className="search-picker-logo">
                <img src={leadLogo} alt="" />
              </span>
            ) : (
              leadIcon && <Icon name={leadIcon} />
            )}
          </span>
        )}
        <span className={selected ? "search-picker-text" : "search-picker-text placeholder"}>{buttonText}</span>
        {selected?.hint && <small>{selected.hint}</small>}
        <Icon name="chevron-down" className="search-picker-chevron" />
      </button>
      {open && (
        // Typing happens in the field itself: this sits over the button's text while the list is open.
        <input
          type="text"
          className="search-picker-input"
          role="combobox"
          aria-label={`Search ${label.toLowerCase()}`}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={choices.length ? `${listId}-${active}` : undefined}
          placeholder={buttonText}
          autoComplete="off"
          autoFocus={focusSearch}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onSearchKey}
        />
      )}
      {placement && (
        <span
          className={["search-picker-pop", placement.up ? "up" : "", leaving ? "leaving" : ""].filter(Boolean).join(" ")}
          style={style}
          aria-hidden={leaving || undefined}
          inert={leaving || undefined}
        >
          <ul ref={listRef} id={listId} role="listbox" aria-label={label}>
            {choices.map((item, index) => {
              return [
                item && headed[index] && (
                  <li key={`g-${item.group}`} role="presentation" className="search-picker-group">
                    {item.group}
                  </li>
                ),
                <li
                  key={item?.id ?? "none"}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={(item?.id ?? null) === (selected?.id ?? null)}
                  data-active={index === active ? "" : undefined}
                  // Keep focus in the search box so the click doesn't blur it first.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => index !== active && setActive(index)}
                  onClick={() => choose(index)}
                >
                  {item?.logo ? (
                    <span className="search-picker-icon has-logo">
                      <img src={item.logo} alt="" />
                    </span>
                  ) : (
                    item?.icon && (
                      <span className="search-picker-icon">
                        <Icon name={item.icon} />
                      </span>
                    )
                  )}
                  <span className="search-picker-name">{item ? <Highlight text={item.label} query={q} /> : none}</span>
                  {item?.hint && <small>{item.hint}</small>}
                  <Icon name="check" className="search-picker-check" />
                </li>,
              ];
            })}
            {choices.length === 0 && (
              <li role="presentation" className="search-picker-empty">
                Nothing matches “{query}”
              </li>
            )}
          </ul>
        </span>
      )}
    </span>
  );
}
