/**
 * Phones don't shrink the page when the on-screen keyboard opens: Safari never does, and Chrome
 * on Android only shrinks the "visual viewport". So a popup sized to the screen keeps its lower
 * half behind the keyboard, where nothing can scroll it into view.
 *
 * While a popup is open, this keeps --vv-top, --vv-bottom and --vv-height on <html> in step with
 * the part of the screen the keyboard leaves, and calls onChange after each change. A zoomed-in
 * page is left alone, as pinch zoom also shrinks the visual viewport.
 */
export function trackVisibleViewport(onChange?: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement.style;
  const clear = () => ["--vv-top", "--vv-bottom", "--vv-height"].forEach((name) => root.removeProperty(name));

  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (Math.abs(vv.scale - 1) > 0.01) {
        clear();
      } else {
        const top = Math.max(0, vv.offsetTop);
        const bottom = Math.max(0, window.innerHeight - vv.height - top);
        root.setProperty("--vv-top", `${Math.round(top)}px`);
        root.setProperty("--vv-bottom", `${Math.round(bottom)}px`);
        root.setProperty("--vv-height", `${Math.round(vv.height)}px`);
      }
      onChange?.();
    });
  };

  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
  return () => {
    cancelAnimationFrame(frame);
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    clear();
  };
}

/** A field the keyboard types into (not a button, checkbox or picker). */
export function isTextField(el: Element | null): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image"].includes(el.type);
}

/** Top and bottom of the part of the screen you can see, in the coordinates getBoundingClientRect uses. */
export function visibleArea(): { top: number; bottom: number } {
  const vv = window.visualViewport;
  if (!vv || Math.abs(vv.scale - 1) > 0.01) return { top: 0, bottom: window.innerHeight };
  return { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
}
