import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

// Paths are relative to the frontend folder, where vitest runs.
const styles = readFileSync(resolve("src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [readFileSync(path, "utf8")] : [];
  });
}

it("has no CSS class that no component uses any more", () => {
  const code = sources(resolve("src")).join("\n");
  // Selectors only, not values like var(--x) or 0.5rem; then every .class-name in them.
  const selectors = styles.replace(/\{[^{}]*\}/g, "{}").replace(/@[^{]+\{/g, "");
  const classes = new Set([...selectors.matchAll(/\.(-?[a-z][\w-]*)/gi)].map((m) => m[1]));
  // A class counts as used when its name appears whole in the code, as markup or as a value
  // put into a class name (a tone such as "over" in `meter-fill ${tone}`).
  const unused = [...classes].filter((name) => !new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(code));
  expect(unused).toEqual([]);
});
