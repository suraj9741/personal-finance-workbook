import { afterEach, beforeEach, expect, it } from "vitest";
import { THEME_KEY, applyTheme, readTheme, saveTheme } from "./theme";

beforeEach(() => {
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f5f7" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />`;
});
afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const metaColours = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);

it("defaults to System and remembers a choice", () => {
  expect(readTheme()).toBe("system");
  saveTheme("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  expect(readTheme()).toBe("dark");
  saveTheme("system");
  expect(localStorage.getItem(THEME_KEY)).toBeNull();
});

it("ignores a stored value it doesn't know", () => {
  localStorage.setItem(THEME_KEY, "sepia");
  expect(readTheme()).toBe("system");
});

it("sets data-theme and the browser bar colour, and System puts both back", () => {
  applyTheme("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(metaColours()).toEqual(["#000000", "#000000"]);
  applyTheme("light");
  expect(metaColours()).toEqual(["#f5f5f7", "#f5f5f7"]);
  applyTheme("system");
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(metaColours()).toEqual(["#f5f5f7", "#000000"]);
});
