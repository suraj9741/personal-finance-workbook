import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isTextField, trackVisibleViewport, visibleArea } from "./viewport";

// A stand-in for window.visualViewport: the keyboard takes `keyboard` px off the bottom.
let keyboard = 0;
let scale = 1;
const vv = Object.defineProperties(new EventTarget(), {
  height: { get: () => window.innerHeight - keyboard },
  offsetTop: { get: () => 0 },
  scale: { get: () => scale },
});
const root = document.documentElement.style;
const vars = () => ["--vv-top", "--vv-bottom", "--vv-height"].map((name) => root.getPropertyValue(name));

beforeEach(() => {
  keyboard = 0;
  scale = 1;
  vi.stubGlobal("visualViewport", vv);
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => (run(0), 1));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

it("follows the keyboard while a popup is open and clears up after", () => {
  const changed = vi.fn();
  const stop = trackVisibleViewport(changed);
  expect(vars()).toEqual(["0px", "0px", `${window.innerHeight}px`]);

  keyboard = 300;
  vv.dispatchEvent(new Event("resize"));
  expect(vars()).toEqual(["0px", "300px", `${window.innerHeight - 300}px`]);
  expect(visibleArea()).toEqual({ top: 0, bottom: window.innerHeight - 300 });
  expect(changed).toHaveBeenCalledTimes(2);

  stop();
  expect(vars()).toEqual(["", "", ""]);
});

it("leaves a pinch-zoomed page alone", () => {
  scale = 2;
  const stop = trackVisibleViewport();
  expect(vars()).toEqual(["", "", ""]);
  expect(visibleArea()).toEqual({ top: 0, bottom: window.innerHeight });
  stop();
});

it("counts only fields the keyboard types into", () => {
  const field = (html: string) => {
    const box = document.createElement("div");
    box.innerHTML = html;
    return box.firstElementChild;
  };
  expect(isTextField(field("<input>"))).toBe(true);
  expect(isTextField(field('<input type="number">'))).toBe(true);
  expect(isTextField(field("<textarea></textarea>"))).toBe(true);
  expect(isTextField(field('<input type="checkbox">'))).toBe(false);
  expect(isTextField(field("<button></button>"))).toBe(false);
});
